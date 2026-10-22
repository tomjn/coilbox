/**
 * Put the unit in front of the engine.
 *
 * Everything the builder makes is a guess until the engine draws it, so this
 * takes the shortest honest route to that: write the unit into coilbox's own
 * scratch game, let unitsync pick it up, and launch a one-player skirmish
 * through the same flow the singleplayer screen uses. Spawning it is left to
 * the player, because `/give` is one line to type and a spawner would be a
 * gadget to maintain.
 */

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button, useSetting } from "@picoframe/frame";
import {
  Crosshair,
  FolderOpen,
  RefreshCw,
  Rocket,
  RotateCcw,
  ScanSearch,
  Square,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { useUnitDefs } from "@/workshop/config";
import { useModProjects } from "@/workshop/project";
import {
  contentUnitCheck,
  contentUnitCheckCancel,
  type UnitCheckReport,
} from "../../../content/bindings";
import { useCompatSettings } from "../../../content/compatSettings";
import { useUnitsyncGameHeaders } from "../../../content/config";
import { describeError } from "../../../i18n/uiError";
import { SCRATCH_FOLDER } from "../../../lib/generatedGames";
import { playAskLuaRules } from "../../../play/bindings";
import {
  type CompatTarget,
  resolveCompatTarget,
} from "../../../play/compatTarget";
import {
  gameOptionSchema,
  initialParticipants,
  mapOptionSchema,
  toBattleConfig,
} from "../../../play/config";
import { usePlay } from "../../../play/PlayProvider";
import { GamePickerButton } from "../../../play/pages/components/GamePickerButton";
import { GamePickerPanel } from "../../../play/pages/components/GamePickerPanel";
import type { Participant } from "../../../play/participants";
import type { ScratchSandbox } from "../../bindings";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import {
  prepareSandbox,
  SANDBOX_LOADED_REPLY,
  SANDBOX_RELOAD_MESSAGE,
  SANDBOX_REPLY,
  SANDBOX_TEXTURES_MESSAGE,
  SANDBOX_TEXTURES_REPLY,
  sandboxModOptions,
} from "../../sandbox";
import {
  afterScriptReload,
  afterTextureReload,
  type LoadedSandbox,
  loadedFrom,
  relaunchMessage,
  sandboxChanges,
} from "../../sandboxReload";
import { SCRATCH_SIDE } from "../../scratchGame";
import { CHECK_FRAMES, CHECK_SPAWN_FRAME } from "../../unitCheck";
import {
  type WrittenScratchUnit,
  writeScratchGame,
  writeScratchUnit,
} from "../../writeScratchGame";
import { ShowMe } from "./ShowMe";
import { UnitCheckResult } from "./UnitCheckResult";
import { uniqueByName, useTestGame } from "./useTestGame";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
}

/** Random start position: a test needs a spawn, not a chosen one. */
const START_POS_RANDOM = 1;

/** The three things the drawer can do, so a busy label lands on the right button. */
type Action = "launch" | "play" | "check";

type Phase =
  | { state: "idle" }
  | { state: "writing" }
  | { state: "scanning" }
  | { state: "playing" }
  | { state: "checking" }
  | { state: "done" }
  | { state: "failed"; message: string };

/** The sandbox this drawer launched, while it runs (issue #3346). */
interface SandboxRun {
  /** Null until the engine process exists. */
  runId: string | null;
  baseGame: string;
  baseArchive: string;
  sandbox: ScratchSandbox;
  loaded: LoadedSandbox;
}

type Reload =
  | { state: "idle" }
  | { state: "reloading" }
  | { state: "done"; message: string; relaunch: boolean }
  | { state: "failed"; message: string };

/** What the sandbox gadget puts before its reason when a reload did not happen. */
const FAILED = `${SANDBOX_REPLY}failed:`;

function busyLabel(state: Phase["state"]): string | undefined {
  if (state === "writing") return t`Writing the scratch game`;
  if (state === "scanning") return t`Letting the engine find it`;
  if (state === "playing") return t`Game running`;
  if (state === "checking") return t`Running the engine`;
  return undefined;
}

export function TestDrawer({ open, onOpenChange, project, pack, raw }: Props) {
  const { target, targetLoading, scan, games, game, setGameName } =
    useTestGame();
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    target?.enginePath,
    target?.dataDir,
  );
  const { running, launch, cancel } = usePlay();
  const [compatSettings] = useCompatSettings();
  // The test game's own weapons, which a game weapon the unit names is checked
  // against, and the workshop a library weapon is read from (issue #4264).
  const { projects: workshopProjects } = useModProjects();
  const { defs, defsFor } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const gameDefs = defs && defsFor === game?.primaryArchive.name ? defs : null;
  const gameWeapons = gameDefs ? gameDefs.weaponDefs : null;
  // A unit built to move with no movement of its own walks on one of the test
  // game's classes (issue #4472).
  const gameMovement = gameDefs
    ? { units: gameDefs.units, moveDefs: gameDefs.moveDefs }
    : null;

  const [mapName, setMapName] = useSetting<string>("lego.testMap", "");

  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  // Swaps the drawer's body for the game picker rather than stacking a second
  // drawer on this one (issue #2995).
  const [pickingGame, setPickingGame] = useState(false);
  // This stays mounted while closed, so reopening starts back on the settings.
  useEffect(() => {
    if (!open) setPickingGame(false);
  }, [open]);
  /** Kept once written, so the reveal button survives a later failure. */
  const [scratchDir, setScratchDir] = useState<string | null>(null);
  /** The weapons and builders the last write left out of the scratch unit. */
  const [leftOut, setLeftOut] = useState<string[]>([]);
  /** The last load check's report, cleared when another run starts. */
  const [check, setCheck] = useState<UnitCheckReport | null>(null);
  /** Which action the busy phases belong to. */
  const [action, setAction] = useState<Action>("launch");
  const [sandboxRun, setSandboxRun] = useState<SandboxRun | null>(null);
  const [reload, setReload] = useState<Reload>({ state: "idle" });
  /** The launch in flight, so a relaunch can wait for it to finish. */
  const playing = useRef<Promise<void> | null>(null);

  const maps = uniqueByName(scan.data?.maps ?? []);
  const map = maps.find((m) => m.name === mapName) ?? maps[0];

  const busy =
    phase.state === "writing" ||
    phase.state === "scanning" ||
    phase.state === "playing" ||
    phase.state === "checking";

  const scanError = scan.error;
  const unitName = project.unitName;
  const blocker =
    !targetLoading && !target
      ? t`No engine is installed. Add one from Content before testing a unit.`
      : scanError
        ? t`The content scan failed: ${scanError}`
        : scan.data && games.length === 0
          ? t`No game is installed. A unit needs one to be built on top of.`
          : scan.data && maps.length === 0
            ? t`No map is installed. Download one from Content first.`
            : running && !busy
              ? t`A game is already running.`
              : null;

  const waiting = targetLoading || (!!target && !scan.data && scan.loading);

  /**
   * The game the scratch game is written over. With the picked game's
   * compatibility switch on that is its mutator, so the unit is tested over the
   * fixes (issue #4664). Off, nothing about the mutator is read. A stale or
   * missing mutator throws its message, which the callers show as the failure.
   */
  async function compatTarget(): Promise<CompatTarget> {
    if (!target || !game) return { kind: "off" };
    const compat = await resolveCompatTarget({
      target,
      game,
      settings: compatSettings,
    });
    if (compat.kind === "blocked") throw new Error(compat.message);
    return compat;
  }

  async function scratchGame(
    compat: CompatTarget,
    sandbox?: ScratchSandbox,
  ): Promise<(WrittenScratchUnit & { name: string }) | null> {
    if (!target || !game) return null;
    setPhase({ state: "writing" });
    const written = await writeScratchGame({
      target,
      baseGame: compat.kind === "use" ? compat.gameType : game.name,
      baseArchive:
        compat.kind === "use" ? compat.gameArchive : game.primaryArchive.name,
      project,
      pack,
      raw,
      workshopProjects,
      gameWeapons,
      gameMovement,
      sandbox,
      onWritten: setScratchDir,
      onScanning: () => setPhase({ state: "scanning" }),
    });
    setLeftOut([...written.weaponsLeftOut, ...written.buildListLeftOut]);
    return written;
  }

  /** Write the scratch game, launch it, and say how the engine exited. */
  function play(...args: Parameters<typeof launchAndWait>) {
    const run = launchAndWait(...args);
    playing.current = run;
    return run;
  }

  async function launchAndWait(
    next: Action,
    setup: () => Promise<{
      sandbox?: ScratchSandbox;
      participants: Participant[];
      startPosType: number;
      modOptions: Record<string, string>;
    }>,
  ) {
    if (!target || !game || !map) return;
    setCheck(null);
    setAction(next);
    try {
      setPhase({ state: "writing" });
      const compat = await compatTarget();
      const { sandbox, participants, startPosType, modOptions } = await setup();
      const written = await scratchGame(compat, sandbox);
      if (!written) return;
      const scratchName = written.name;

      setPhase({ state: "playing" });
      setReload({ state: "idle" });
      // A sandbox can be reached while it runs, so its script can be reloaded
      // (issue #3346). Recorded before the launch, with the run id to follow
      // once the engine exists.
      const reachable = sandbox
        ? {
            autohost: true,
            onEngineStarted: (runId: string) =>
              setSandboxRun((run) => run && { ...run, runId }),
          }
        : {};
      if (sandbox) {
        setSandboxRun({
          runId: null,
          baseGame: compat.kind === "use" ? compat.gameType : game.name,
          baseArchive:
            compat.kind === "use"
              ? compat.gameArchive
              : game.primaryArchive.name,
          sandbox,
          loaded: loadedFrom(written),
        });
      }
      const result = await launch("skirmish", {
        ...reachable,
        config: toBattleConfig({
          participants,
          mapName: map.name,
          gameType: scratchName,
          compatBase: compat.kind === "use" ? compat.baseName : undefined,
          startPosType,
          modOptions,
          // The scratch game is a mutator over the picked game and declares no
          // options of its own, so the base game's are the ones that apply.
          optionSchema: await gameOptionSchema(
            target,
            game.primaryArchive.name,
          ),
          mapOptionSchema: await mapOptionSchema(target, map.name),
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
      setPhase({ state: "done" });
    } catch (error) {
      setPhase({
        state: "failed",
        message: describeError(error),
      });
    } finally {
      // What a reload said was about the game that has now closed.
      setSandboxRun(null);
      setReload({ state: "idle" });
    }
  }

  function run() {
    return play("launch", async () => ({
      // On the scratch game's own side, so a base game that does read the
      // side's start unit resolves it rather than seeing an empty side.
      participants: [{ ...initialParticipants()[0], side: SCRATCH_SIDE }],
      startPosType: START_POS_RANDOM,
      modOptions: {},
    }));
  }

  /** "Launch sandbox with targets": the sandbox mission (issue #3341). */
  function playSandbox() {
    return play("play", async () => {
      if (!target || !game || !map) throw new Error(t`Nothing to play on.`);
      const { sandbox, scenario } = await prepareSandbox({
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        game,
        mapName: map.name,
        unitName: project.unitName,
        builtBy: project.builtBy ?? [],
      });
      return {
        sandbox,
        participants: scenario.setup.participants,
        startPosType: scenario.setup.startPosType,
        modOptions: sandboxModOptions(),
      };
    });
  }

  /**
   * Export the unit into the running sandbox and reload what the engine can,
   * which is the script and the textures. Says what needs a relaunch for the
   * rest.
   */
  async function reloadSandbox() {
    const run = sandboxRun;
    if (!run?.runId || !target) return;
    setReload({ state: "reloading" });
    try {
      const written = await writeScratchUnit({
        target,
        baseGame: run.baseGame,
        baseArchive: run.baseArchive,
        project,
        pack,
        raw,
        workshopProjects,
        gameWeapons,
        gameMovement,
        sandbox: run.sandbox,
      });
      setLeftOut([...written.weaponsLeftOut, ...written.buildListLeftOut]);
      const changes = sandboxChanges(run.loaded, written);
      const said: string[] = [];
      if (changes.reload) {
        const { answer } = await playAskLuaRules({
          runId: run.runId,
          message: SANDBOX_RELOAD_MESSAGE,
          reply: SANDBOX_REPLY,
        });
        if (answer !== SANDBOX_LOADED_REPLY) {
          throw new Error(
            answer.startsWith(FAILED) ? answer.slice(FAILED.length) : answer,
          );
        }
        setSandboxRun(
          (current) =>
            current && {
              ...current,
              loaded: afterScriptReload(current.loaded, written),
            },
        );
        said.push(
          t`Reloaded the script. Every ${unitName} in the game runs it now.`,
        );
      }
      if (changes.textures) {
        const { answer } = await playAskLuaRules({
          runId: run.runId,
          message: SANDBOX_TEXTURES_MESSAGE,
          reply: SANDBOX_REPLY,
        });
        if (answer !== SANDBOX_TEXTURES_REPLY) {
          throw new Error(
            answer.startsWith(FAILED) ? answer.slice(FAILED.length) : answer,
          );
        }
        setSandboxRun(
          (current) =>
            current && {
              ...current,
              loaded: afterTextureReload(current.loaded, written),
            },
        );
        said.push(
          t`Reloaded the texture. Every ${unitName} in the game shows it now.`,
        );
      }
      const relaunch = relaunchMessage(changes.relaunch);
      if (relaunch) said.push(relaunch);
      if (said.length === 0) {
        said.push(t`Nothing has changed since the game started.`);
      }
      setReload({
        state: "done",
        message: said.join(" "),
        relaunch: changes.relaunch.length > 0,
      });
    } catch (error) {
      setReload({
        state: "failed",
        message: describeError(error),
      });
    }
  }

  /** Close the running sandbox and play a new one with the unit as it is now. */
  async function relaunchSandbox() {
    cancel();
    await playing.current;
    await playSandbox();
  }

  async function checkLoads() {
    if (!target || !game || !map) return;
    setCheck(null);
    setAction("check");
    try {
      const written = await scratchGame(await compatTarget());
      if (!written) return;
      const scratchName = written.name;

      setPhase({ state: "checking" });
      const { report } = await contentUnitCheck({
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        game: scratchName,
        map: map.name,
        unitName: project.unitName,
        spawnFrame: CHECK_SPAWN_FRAME,
        frames: CHECK_FRAMES,
      });
      setCheck(report);
      setPhase({ state: "idle" });
    } catch (error) {
      setPhase({
        state: "failed",
        message: describeError(error),
      });
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              <Trans>Test {unitName} in game</Trans>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t`Close`}>
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {pickingGame ? (
            <div className="flex min-h-0 flex-1 flex-col px-2 pt-3">
              <GamePickerPanel
                games={games}
                headers={gameHeaders}
                selectedName={game?.name ?? ""}
                onSelect={setGameName}
                onBack={() => setPickingGame(false)}
                backLabel={t`Back to the test settings`}
                gamesLoading={waiting}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
              <p className="text-xs text-muted-foreground">
                <Trans>
                  The unit is written into a scratch game of coilbox's own,
                  which depends on the game you pick below. Your install is not
                  touched, and deleting <code>{SCRATCH_FOLDER}</code> undoes all
                  of it.
                </Trans>
              </p>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  <Trans>Build on</Trans>
                </span>
                <GamePickerButton
                  value={game?.name ?? ""}
                  games={games}
                  headers={gameHeaders}
                  placeholder={
                    waiting
                      ? t`Reading games`
                      : scan.error
                        ? t`Scan failed`
                        : t`No game installed`
                  }
                  disabled={busy || games.length === 0}
                  onClick={() => setPickingGame(true)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  <Trans>Map</Trans>
                </span>
                <OptionSelect
                  value={map?.name ?? ""}
                  onValueChange={setMapName}
                  options={maps.map((m) => ({ value: m.name, label: m.name }))}
                  placeholder={
                    waiting
                      ? t`Reading maps`
                      : scan.error
                        ? t`Scan failed`
                        : t`No map installed`
                  }
                  disabled={busy || maps.length === 0}
                />
              </div>

              <div className="flex flex-col gap-2 rounded border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <p>
                  <Trans>
                    <code>{unitName}</code> is the scratch game's start unit, so
                    it is waiting at your start position a second into the
                    match. Nothing has to build it and no cheats are needed.
                  </Trans>
                </p>
                <p>
                  <Trans>
                    If it is not there, press Enter and type <code>/cheat</code>{" "}
                    then <code>/give {unitName}</code> to place one by hand.
                  </Trans>
                </p>
              </div>

              <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
                <Button
                  onClick={() => void run()}
                  disabled={busy || !!blocker || !game || !map}
                >
                  <Rocket className="size-4" />
                  {busy && action === "launch"
                    ? busyLabel(phase.state)
                    : t`Launch with it as start unit`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void playSandbox()}
                  disabled={busy || !!blocker || !game || !map}
                >
                  <Crosshair className="size-4" />
                  {busy && action === "play"
                    ? busyLabel(phase.state)
                    : t`Launch sandbox with targets`}
                </Button>
                {running && sandboxRun ? (
                  <Button
                    variant="outline"
                    onClick={() => void reloadSandbox()}
                    disabled={!sandboxRun.runId || reload.state === "reloading"}
                  >
                    <RefreshCw className="size-4" />
                    {!sandboxRun.runId
                      ? t`Waiting for the engine to start`
                      : reload.state === "reloading"
                        ? t`Reloading`
                        : t`Reload into the sandbox`}
                  </Button>
                ) : null}
                {reload.state === "done" ? (
                  <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                    <p>{reload.message}</p>
                    {reload.relaunch ? (
                      <Button
                        variant="outline"
                        onClick={() => void relaunchSandbox()}
                        disabled={!sandboxRun?.runId}
                      >
                        <RotateCcw className="size-4" />
                        <Trans>Relaunch</Trans>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {reload.state === "failed" ? (
                  <p className="text-xs text-destructive">{reload.message}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => void checkLoads()}
                    disabled={busy || !!blocker || !game || !map}
                  >
                    <ScanSearch className="size-4" />
                    {busy && action === "check"
                      ? busyLabel(phase.state)
                      : t`Check it loads`}
                  </Button>
                  {phase.state === "checking" ? (
                    <Button
                      variant="outline"
                      onClick={() => void contentUnitCheckCancel(undefined)}
                    >
                      <Square className="size-4" />
                      <Trans>Stop</Trans>
                    </Button>
                  ) : null}
                </div>
              </div>

              {check ? (
                <UnitCheckResult report={check} unitName={project.unitName} />
              ) : null}

              {blocker ? (
                <p className="text-xs text-destructive">{blocker}</p>
              ) : null}

              {phase.state === "failed" ? (
                <p className="text-xs text-destructive">{phase.message}</p>
              ) : null}

              {phase.state === "done" ? (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    The game has closed. Launch again to test a change.
                  </Trans>
                </p>
              ) : null}

              {leftOut.map((line) => (
                <p key={line} className="text-xs text-muted-foreground">
                  <Trans>Left out: {line}</Trans>
                </p>
              ))}

              {scratchDir ? (
                <div className="flex flex-col gap-2 text-xs">
                  <code className="break-all">{scratchDir}</code>
                  <ShowMe path={scratchDir}>
                    <FolderOpen className="size-4" />{" "}
                    <Trans>Show me the scratch game</Trans>
                  </ShowMe>
                </div>
              ) : null}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
