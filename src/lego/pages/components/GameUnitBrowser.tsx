/**
 * The units of a unit's own game, as a source of parts (issue #3264).
 *
 * Lives in the Inventory as the "Game units" kind. It reads the game the open
 * unit is for and no other (`browseSource`). Rows use the names and build pics
 * of the model picker, and opening one lists its pieces. Each piece can be
 * lifted, with everything under it, into the inventory (#3262): see
 * `liftPiece.ts`.
 */

import { Button } from "@picoframe/frame";
import { ArrowUpFromLine, ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  useUnitsyncArchiveTree,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "@/content/config";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import { usePreferredTarget } from "@/play/config";
import { adoptGameScript } from "../../adoptGameScript";
import { legoImportS3o, legoReadS3o } from "../../bindings";
import {
  modelSource,
  type StagedModel,
  stageModel,
  stageTextures,
} from "../../gameImport";
import { type GameModelRow, gameModelRows } from "../../gameModels";
import {
  browseSource,
  gameUnitRows,
  type PieceLine,
  pieceLines,
  searchUnitRows,
} from "../../gameUnits";
import type { S3oModel } from "../../importS3o";
import type { RoleProposal } from "../../inferRoles";
import { trimLiftedMeshes } from "../../liftIntoUnit";
import {
  liftFromImport,
  wholeFromImport,
  withMeshBoxes,
} from "../../liftPiece";
import { liftedRolesSummary } from "../../liftRoles";
import type { LegoProject } from "../../model";
import { loadRawGeometry } from "../../rawGeometry";
import { gameRecordFor } from "../../unitGame";

/** How many rows are drawn at once. A big game has thousands of units, so the
 *  search narrows the list rather than the list growing. */
const ROW_CAP = 200;

type Pieces =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | {
      state: "ready";
      lines: PieceLine[];
      /** What the lift reads again: the model on disk and its header. */
      staged: StagedModel;
      model: S3oModel;
      row: GameModelRow;
    };

/** One piece's lift, shown on its line. */
type Lift =
  | { path: string; state: "lifting" }
  | { path: string; state: "done"; roles: string | null }
  | { path: string; state: "failed"; message: string };

interface Props {
  /** The unit being built. Its game decides which units are listed. */
  project: LegoProject;
  query: string;
  /** Keeps a lifted piece in the inventory. Absent offers no lift. */
  onLift?: (module: LegoProject) => Promise<void>;
}

export function GameUnitBrowser({ project, query, onLift }: Props) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installed = useMemo(() => scan.data?.games ?? [], [scan.data]);
  const source = useMemo(
    () => browseSource(project, installed),
    [project, installed],
  );
  const archive =
    source.state === "ready" ? source.game.primaryArchive.name : undefined;

  const { tree, loading: treeLoading } = useUnitsyncArchiveTree(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const { dataset, status } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const units = useMemo(() => dataset?.units ?? [], [dataset]);
  const buildpics = useUnitsyncUnitBuildpics(
    target?.enginePath,
    target?.dataDir,
    archive,
    useMemo(() => units.map((u) => u.name), [units]),
  );

  const rows = useMemo(() => {
    if (!tree || !archive) return null;
    return gameUnitRows(
      gameModelRows({
        files: tree.files,
        units,
        projects: [],
        archive,
        archivePath: tree.archivePath,
      }).rows,
    );
  }, [tree, units, archive]);
  const matched = useMemo(
    () => (rows ? searchUnitRows(rows, query) : []),
    [rows, query],
  );

  const [openMember, setOpenMember] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Pieces | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const reads = useRef(0);

  // A different game is a different list, so nothing stays open across it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: archive is the trigger
  useEffect(() => {
    reads.current += 1;
    setOpenMember(null);
    setPieces(null);
    setLift(null);
  }, [archive]);

  async function toggle(row: GameModelRow) {
    if (openMember === row.member) {
      reads.current += 1;
      setOpenMember(null);
      setPieces(null);
      return;
    }
    const thisRead = ++reads.current;
    setOpenMember(row.member);
    setLift(null);
    if (!/\.s3o$/i.test(row.member)) {
      setPieces({
        state: "failed",
        message: "Pieces are listed only for .s3o models.",
      });
      return;
    }
    if (!target || !archive || !tree) return;
    setPieces({ state: "loading" });
    try {
      const staged = await stageModel(
        target,
        { archive, archivePath: tree.archivePath, member: row.member },
        tree.files,
      );
      const model = await legoReadS3o({ path: staged.path });
      if (thisRead !== reads.current) return;
      setPieces({
        state: "ready",
        lines: pieceLines(model.root),
        staged,
        model,
        row,
      });
    } catch (error) {
      if (thisRead !== reads.current) return;
      setPieces({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Import the open model again under a new module's id, which stores its
   * geometry and textures, and keep the piece and everything under it. Reading
   * the game is all this does: nothing in it is written.
   */
  async function liftPiece(line: PieceLine) {
    if (!onLift || pieces?.state !== "ready") return;
    if (!target || !archive || !tree || source.state !== "ready") return;
    const { staged, model, row } = pieces;
    const picked = {
      archive,
      archivePath: tree.archivePath,
      member: row.member,
    };
    setLift({ path: line.path, state: "lifting" });
    try {
      await stageTextures(target, picked, staged, tree.files, [
        model.texture1,
        model.texture2,
      ]);
      const id = crypto.randomUUID();
      const result = await legoImportS3o({ path: staged.path, id });
      const options = {
        id,
        from: {
          name: source.game.name,
          archive,
          member: row.member,
          ...(row.unit ? { unit: row.unit } : {}),
        },
        source: modelSource(picked),
        unpacked: staged.staged !== null,
        packId: project.packId,
        packVersion: project.packVersion,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      };
      // The script names every piece of the model, so it is asked about the
      // whole unit and the lifted pieces take their share of the answer.
      const whole = wholeFromImport(result, options);
      const module = liftFromImport(result, line.path, {
        ...options,
        game: gameRecordFor(source.game, installed),
        whole,
        roles: await scriptRoles(whole, target),
      });
      if (!module) throw new Error(`${line.name} is not in this model.`);
      // The import wrote every mesh of the model. Keep only the lifted ones.
      // Its meshes are then read back for the box of each, for the connectors
      // and pivots the piece gets. A piece without one is measured when it goes
      // into a unit, so a failed trim does not fail the lift: the full file
      // still holds every mesh the pieces name.
      const raw = await trimLiftedMeshes(module).catch(() =>
        loadRawGeometry(id).catch(() => null),
      );
      await onLift(raw ? withMeshBoxes(module, raw) : module);
      setLift({
        path: line.path,
        state: "done",
        roles: liftedRolesSummary(module),
      });
    } catch (error) {
      setLift({
        path: line.path,
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (source.state !== "ready") {
    return <Note>{source.message}</Note>;
  }
  if (treeLoading || status === "loading") {
    return <Note>Reading {source.game.name}.</Note>;
  }
  if (!rows) {
    return <Note>Could not read this game's archive.</Note>;
  }
  if (matched.length === 0) {
    return <Note>No units match.</Note>;
  }

  const shown = matched.slice(0, ROW_CAP);
  return (
    <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-1">
      {shown.map((row) => {
        const isOpen = openMember === row.member && pieces !== null;
        return (
          <li key={`${row.member}:${row.unit}`}>
            <button
              type="button"
              onClick={() => void toggle(row)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-accent/50"
              title={row.member}
            >
              {isOpen ? (
                <ChevronDown className="size-4 shrink-0" />
              ) : (
                <ChevronRight className="size-4 shrink-0" />
              )}
              <UnitIcon
                display={row.unit ? buildpics?.units?.[row.unit] : undefined}
                pending={!buildpics && units.length > 0}
                size="lg"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {row.label}
              </span>
              <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                {row.unit}
              </span>
            </button>
            {isOpen ? (
              <PieceList
                pieces={pieces}
                lift={lift}
                onLift={onLift ? (line) => void liftPiece(line) : undefined}
              />
            ) : null}
          </li>
        );
      })}
      {matched.length > shown.length ? (
        <li className="px-2 py-1 text-xs text-muted-foreground">
          First {shown.length} of {matched.length}. Search to narrow it down.
        </li>
      ) : null}
    </ul>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * What the unit's own script says its pieces are for. A script that cannot be
 * read or run is no reason to fail the lift, so it answers with nothing and the
 * piece names are left to decide.
 */
async function scriptRoles(
  whole: LegoProject,
  engine: { enginePath: string; dataDir: string },
): Promise<RoleProposal[]> {
  try {
    const adopted = await adoptGameScript(whole, engine);
    return adopted.findings?.proposals ?? [];
  } catch {
    return [];
  }
}

function PieceList({
  pieces,
  lift,
  onLift,
}: {
  pieces: Pieces;
  lift: Lift | null;
  onLift?: (line: PieceLine) => void;
}) {
  if (pieces.state === "loading") {
    return <p className="py-1 pl-12 text-xs text-muted-foreground">Reading.</p>;
  }
  if (pieces.state === "failed") {
    return (
      <p className="py-1 pl-12 text-xs text-muted-foreground">
        {pieces.message}
      </p>
    );
  }
  return (
    <ul className="py-1 pl-12 text-sm">
      {pieces.lines.map((line) => {
        const here = lift?.path === line.path ? lift : null;
        return (
          <li
            key={line.path}
            className="group flex items-center gap-2"
            style={{ paddingLeft: `${line.depth * 0.75}rem` }}
          >
            <span className="truncate">{line.name}</span>
            {onLift ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                disabled={lift?.state === "lifting"}
                onClick={() => onLift(line)}
                aria-label={`Lift ${line.name} into the inventory`}
                title="Lift this piece and the pieces under it into the inventory"
              >
                <ArrowUpFromLine size={14} />
              </Button>
            ) : null}
            {here ? (
              <span className="truncate text-xs text-muted-foreground">
                {here.state === "lifting"
                  ? "Lifting."
                  : here.state === "done"
                    ? here.roles
                      ? `Lifted. Roles: ${here.roles}.`
                      : "Lifted."
                    : here.message}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
