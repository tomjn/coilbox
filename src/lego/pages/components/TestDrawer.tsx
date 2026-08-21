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

import { Button, useSetting } from "@picoframe/frame";
import { FolderOpen, Rocket, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import { primeScan, useUnitsyncScan } from "../../../content/config";
import {
  isScratchArchive,
  SCRATCH_FOLDER,
  withoutGeneratedGames,
} from "../../../lib/generatedGames";
import {
  gameOptionSchema,
  initialParticipants,
  toBattleConfig,
  usePreferredTarget,
} from "../../../play/config";
import { usePlay } from "../../../play/PlayProvider";
import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";
import { exportTextureName, unitAtlas } from "../../atlas";
import { legoExport, legoOpenPath, legoScratchGame } from "../../bindings";
import { unitScript } from "../../luaScript";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { importedTextures } from "../../rawImport";
import { buildS3o } from "../../s3oBuild";
import {
  buildModInfo,
  buildSideData,
  buildStartUnitGadget,
  SCRATCH_SIDE,
} from "../../scratchGame";
import { buildUnitDef } from "../../unitDef";

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

type Phase =
  | { state: "idle" }
  | { state: "writing" }
  | { state: "scanning" }
  | { state: "playing" }
  | { state: "done" }
  | { state: "failed"; message: string };

const BUSY_LABEL: Record<string, string> = {
  writing: "Writing the scratch game",
  scanning: "Letting the engine find it",
  playing: "Game running",
};

/**
 * Two installed archives can carry the same map or game name. A start script
 * names one, so the second is the same choice offered twice.
 */
function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export function TestDrawer({ open, onOpenChange, project, pack, raw }: Props) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();

  // Remembered app-wide rather than on the unit: which game and map you test
  // against is a habit, not a property of the thing being built.
  const [gameName, setGameName] = useSetting<string>("lego.testGame", "");
  const [mapName, setMapName] = useSetting<string>("lego.testMap", "");

  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  /** Kept once written, so the reveal button survives a later failure. */
  const [scratchDir, setScratchDir] = useState<string | null>(null);

  // The scratch game is itself a game, so it comes back in every scan. Offering
  // it as a base would nest it inside itself, and the scenario editor's test
  // mutator is no better a base than this one is.
  const games = uniqueByName(withoutGeneratedGames(scan.data?.games ?? []));
  const maps = uniqueByName(scan.data?.maps ?? []);
  const game = games.find((g) => g.name === gameName) ?? games[0];
  const map = maps.find((m) => m.name === mapName) ?? maps[0];

  const busy =
    phase.state === "writing" ||
    phase.state === "scanning" ||
    phase.state === "playing";

  const blocker =
    !targetLoading && !target
      ? "No engine is installed. Add one from Content before testing a unit."
      : scan.error
        ? `The content scan failed: ${scan.error}`
        : scan.data && games.length === 0
          ? "No game is installed. A unit needs one to be built on top of."
          : scan.data && maps.length === 0
            ? "No map is installed. Download one from Content first."
            : running && !busy
              ? "A game is already running."
              : null;

  const waiting = targetLoading || (!!target && !scan.data && scan.loading);

  async function run() {
    if (!target || !game || !map) return;
    // An imported unit draws with its own two textures out of the store. A
    // built one samples one atlas, and only its own: an s3o names one texture.
    // A unit whose atlas is not installed still tests, untextured, rather than
    // failing on a file that cannot be copied.
    const atlas = unitAtlas(project, pack.library.atlases);
    const written = exportTextureName(atlas.texture);
    const imported = project.imported
      ? importedTextures(project.imported)
      : null;
    const model = buildS3o(project, pack, raw, {
      texture1: imported ? imported.texture1 : written,
      texture2: imported?.texture2,
    });
    if (!model) {
      setPhase({ state: "failed", message: "This unit has no root piece." });
      return;
    }
    try {
      setPhase({ state: "writing" });
      const { dir } = await legoScratchGame({
        dataDir: target.dataDir,
        folder: SCRATCH_FOLDER,
        modinfo: buildModInfo(game.name),
        sidedata: buildSideData(project.unitName),
        gadget: buildStartUnitGadget(project.unitName),
      });
      setScratchDir(dir);
      await legoExport({
        dir,
        unitName: project.unitName,
        textures: {
          atlas:
            !imported && atlas.installed
              ? {
                  name: atlas.texture,
                  pack: atlas.installed.folder,
                  writeAs: written,
                }
              : null,
          stored: imported?.place ?? [],
        },
        script: unitScript(project),
        unitDef: buildUnitDef(project, model),
        model,
      });

      // The engine takes its game list from the same archive cache unitsync
      // writes, so a forced rescan both registers the scratch game and tells us
      // the name a start script has to ask for.
      setPhase({ state: "scanning" });
      const rescanned = await primeScan(
        target.enginePath,
        target.dataDir,
        true,
      );
      const scratch = rescanned.games.find((g) =>
        isScratchArchive(g.primaryArchive.name),
      );
      if (!scratch) {
        setPhase({
          state: "failed",
          message: `The engine did not pick up ${SCRATCH_FOLDER}. Check that ${game.name} is still installed.`,
        });
        return;
      }

      setPhase({ state: "playing" });
      const result = await launch("skirmish", {
        config: toBattleConfig({
          // On the scratch game's own side, so a base game that does read the
          // side's start unit resolves it rather than seeing an empty side.
          participants: [{ ...initialParticipants()[0], side: SCRATCH_SIDE }],
          mapName: map.name,
          gameType: scratch.name,
          startPosType: START_POS_RANDOM,
          modOptions: {},
          // The scratch game is a mutator over the picked game and declares no
          // options of its own, so the base game's are the ones that apply.
          optionSchema: await gameOptionSchema(
            target,
            game.primaryArchive.name,
          ),
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
      setPhase({ state: "done" });
    } catch (error) {
      setPhase({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
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
              Test {project.unitName} in game
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <p className="text-xs text-muted-foreground">
              The unit is written into a scratch game of coilbox's own, which
              depends on the game you pick below. Your install is not touched,
              and deleting <code>{SCRATCH_FOLDER}</code> undoes all of it.
            </p>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Build on</span>
              <OptionSelect
                value={game?.name ?? ""}
                onValueChange={setGameName}
                options={games.map((g) => ({ value: g.name, label: g.name }))}
                placeholder={waiting ? "Reading games" : "No game installed"}
                disabled={busy || games.length === 0}
              />
            </div>

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

            <div className="flex flex-col gap-2 rounded border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <p>
                <code>{project.unitName}</code> is the scratch game's start
                unit, so it is waiting at your start position a second into the
                match. Nothing has to build it and no cheats are needed.
              </p>
              <p>
                If it is not there, press Enter and type <code>/cheat</code>{" "}
                then <code>/give {project.unitName}</code> to place one by hand.
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <Button
                onClick={() => void run()}
                disabled={busy || !!blocker || !game || !map}
              >
                <Rocket className="size-4" />
                {busy ? BUSY_LABEL[phase.state] : "Launch"}
              </Button>
            </div>

            {blocker ? (
              <p className="text-xs text-destructive">{blocker}</p>
            ) : null}

            {phase.state === "failed" ? (
              <p className="text-xs text-destructive">{phase.message}</p>
            ) : null}

            {phase.state === "done" ? (
              <p className="text-xs text-muted-foreground">
                The game has closed. Launch again to test a change.
              </p>
            ) : null}

            {scratchDir ? (
              <div className="flex flex-col gap-2 text-xs">
                <code className="break-all">{scratchDir}</code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void legoOpenPath({ path: scratchDir })}
                >
                  <FolderOpen className="size-4" /> Show me the scratch game
                </Button>
              </div>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
