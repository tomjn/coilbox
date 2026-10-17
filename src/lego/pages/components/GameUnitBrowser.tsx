/**
 * The units of a unit's own game, as a source of parts (issue #3264).
 *
 * Lives in the Inventory as the "Game units" kind. It reads the game the open
 * unit is for and no other (`browseSource`). Rows use the names and build pics
 * of the model picker, and opening one lists its pieces. Lifting a piece into
 * the inventory is #3262 and plugs in where the pieces are listed.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  useUnitsyncArchiveTree,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "@/content/config";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import { usePreferredTarget } from "@/play/config";
import { legoReadS3o } from "../../bindings";
import { stageModel } from "../../gameImport";
import { type GameModelRow, gameModelRows } from "../../gameModels";
import {
  browseSource,
  gameUnitRows,
  type PieceLine,
  pieceLines,
  searchUnitRows,
} from "../../gameUnits";
import type { LegoProject } from "../../model";

/** How many rows are drawn at once. A big game has thousands of units, so the
 *  search narrows the list rather than the list growing. */
const ROW_CAP = 200;

type Pieces =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; lines: PieceLine[] };

interface Props {
  /** The unit being built. Its game decides which units are listed. */
  project: LegoProject;
  query: string;
}

export function GameUnitBrowser({ project, query }: Props) {
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
  const reads = useRef(0);

  // A different game is a different list, so nothing stays open across it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: archive is the trigger
  useEffect(() => {
    reads.current += 1;
    setOpenMember(null);
    setPieces(null);
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
      setPieces({ state: "ready", lines: pieceLines(model.root) });
    } catch (error) {
      if (thisRead !== reads.current) return;
      setPieces({
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
            {isOpen ? <PieceList pieces={pieces} /> : null}
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

function PieceList({ pieces }: { pieces: Pieces }) {
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
      {pieces.lines.map((line) => (
        <li
          key={line.path}
          className="truncate"
          style={{ paddingLeft: `${line.depth * 0.75}rem` }}
        >
          {line.name}
        </li>
      ))}
    </ul>
  );
}
