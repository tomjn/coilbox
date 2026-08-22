/**
 * Open a unit into the builder by choosing a game and then a unit.
 *
 * The file dialog asks for a path, and somebody working on a game knows the unit
 * as "Commander" rather than as `objects3d/armcom.s3o` (#1817). Two tiers answer
 * that: the games coilbox can see, then what that game holds, named after its
 * units and drawn with their build pics.
 *
 * Every game, not only the loose `.sdd` ones. A `.sdd` is what somebody editing
 * a game has, so those sort to the top, but the same reads work on a `.sdz`, an
 * `.sd7` and a rapid `.sdp`, and hiding those would be a limit with no reason
 * behind it. What differs is only how the model reaches disk, which is
 * `gameImport.ts`.
 */

import { Button, Input } from "@picoframe/frame";
import { Blocks, ChevronLeft, ImageOff, Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { GameItem } from "@/content/bindings";
import { buildPicMissing } from "@/content/buildPicMissing";
import {
  useUnitsyncArchiveTree,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "@/content/config";
import { isSdd } from "@/content/format";
import { SddBadge } from "@/content/pages/components/SddBadge";
import { unitIconSrc } from "@/content/unitIcon";
import { usePreferredTarget } from "@/play/config";
import { modelSource, stageModel, stageTextures } from "../../gameImport";
import { type GameModelRow, gameModelRows } from "../../gameModels";
import type { LegoProject } from "../../model";
import { useLegoProjects } from "../../projects";
import {
  ImportResult,
  type ImportStage,
  readModel,
  stageProject,
} from "./ImportResult";

/** How many rows are drawn at once. Balanced Annihilation is 727 models and a
 *  big game is thousands, so the search narrows rather than the list growing. */
const ROW_CAP = 200;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A newly opened unit, for the page to save and open. */
  onOpened: (project: LegoProject) => void;
  /** A model already open as a project, so the page opens that one instead of
   *  quietly making a second copy of it. */
  onExisting: (projectId: string) => void;
}

export function GameModelDrawer({
  open: isOpen,
  onOpenChange,
  onOpened,
  onExisting,
}: Props) {
  const [game, setGame] = useState<GameItem | null>(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<ImportStage>({ state: "idle" });

  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { projects } = useLegoProjects();

  const games = useMemo(() => sortedGames(scan.data?.games ?? []), [scan.data]);

  // Only once a game is chosen, so a closed drawer and the games list cost
  // nothing. Both are session cached, so going back and forth is free.
  const archive = isOpen && game ? game.primaryArchive.name : undefined;
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

  const models = useMemo(() => {
    if (!tree || !archive) return null;
    return gameModelRows({
      files: tree.files,
      units,
      projects,
      archive,
      archivePath: tree.archivePath,
    });
  }, [tree, units, projects, archive]);

  const matched = useMemo(() => {
    if (!models) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return models.rows;
    return models.rows.filter(
      (row) =>
        row.label.toLowerCase().includes(needle) ||
        row.member.toLowerCase().includes(needle) ||
        (row.unit?.includes(needle) ?? false),
    );
  }, [models, query]);

  function back() {
    setGame(null);
    setQuery("");
    setStage({ state: "idle" });
  }

  async function pick(row: GameModelRow) {
    if (row.openedAs) {
      onExisting(row.openedAs);
      return;
    }
    if (!game || !archive || !tree || !target) return;

    const picked = {
      archive,
      archivePath: tree.archivePath,
      member: row.member,
    };
    setStage({ state: "reading" });
    try {
      const staged = await stageModel(target, picked);
      setStage(
        await readModel({
          path: staged.path,
          name: row.label,
          unitName: row.unit ?? row.label,
          source: modelSource(picked),
          unpacked: staged.staged !== null,
          game: {
            name: game.name,
            archive,
            member: row.member,
            ...(row.unit ? { unit: row.unit } : {}),
          },
          beforeImport: (textures) =>
            stageTextures(target, picked, staged, tree.files, textures),
        }),
      );
    } catch (error) {
      setStage({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function accept() {
    const project = stageProject(stage);
    if (project) onOpened(project);
  }

  const loading = Boolean(archive) && (treeLoading || status === "loading");

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) back();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            {game ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to the games"
                onClick={back}
              >
                <ChevronLeft className="size-4" />
              </Button>
            ) : null}
            <DialogPrimitive.Title className="flex-1 truncate text-base font-semibold">
              {game ? game.name : "Open a unit from a game"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {!game ? (
            <GameList
              games={games}
              loading={scan.loading}
              onPick={(picked) => setGame(picked)}
            />
          ) : stage.state !== "idle" ? (
            <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
              <ImportResult
                stage={stage}
                onAtlasChange={(atlas) =>
                  setStage((current) =>
                    current.state === "recovered"
                      ? { ...current, atlas }
                      : current,
                  )
                }
                onAccept={accept}
              />
              {stage.state === "failed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStage({ state: "idle" })}
                >
                  Pick another
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this game's units"
                  aria-label="Search this game's units"
                  className="h-8 pl-8"
                />
              </div>

              {loading ? (
                <p className="text-xs text-muted-foreground">
                  Reading what this game holds.
                </p>
              ) : !models ? (
                <p className="text-xs text-muted-foreground">
                  Could not read this game's archive.
                </p>
              ) : (
                <>
                  <ModelList
                    rows={matched.slice(0, ROW_CAP)}
                    buildpics={buildpics?.units}
                    onPick={(row) => void pick(row)}
                  />
                  <Footnotes
                    shown={Math.min(matched.length, ROW_CAP)}
                    matched={matched.length}
                    threeDoUnits={models.threeDoUnits}
                    unresolved={models.unresolvedUnits}
                  />
                </>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Loose games first, since a `.sdd` is what somebody editing a game has, then
 *  by name so a long list can be read down. */
function sortedGames(games: GameItem[]): GameItem[] {
  return [...games].sort((a, b) => {
    const loose =
      Number(isSdd(b.primaryArchive)) - Number(isSdd(a.primaryArchive));
    return loose || a.name.localeCompare(b.name);
  });
}

function GameList({
  games,
  loading,
  onPick,
}: {
  games: GameItem[];
  loading: boolean;
  onPick: (game: GameItem) => void;
}) {
  if (loading) {
    return (
      <p className="px-5 py-4 text-xs text-muted-foreground">
        Looking for installed games.
      </p>
    );
  }
  if (games.length === 0) {
    return (
      <p className="px-5 py-4 text-xs text-muted-foreground">
        No games are installed, so there is nothing to open a unit out of. Add
        one under Content.
      </p>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
      {games.map((game) => (
        <li key={game.primaryArchive.name}>
          <button
            type="button"
            onClick={() => onPick(game)}
            className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent/50"
          >
            <span className="flex-1 truncate text-sm">{game.name}</span>
            {isSdd(game.primaryArchive) ? <SddBadge /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ModelList({
  rows,
  buildpics,
  onPick,
}: {
  rows: GameModelRow[];
  buildpics?: Record<string, { name?: string } | undefined>;
  onPick: (row: GameModelRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing in this game matched.
      </p>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {rows.map((row) => (
        <li key={`${row.member}:${row.unit ?? ""}`}>
          <button
            type="button"
            onClick={() => onPick(row)}
            className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-accent/50"
            title={row.member}
          >
            <BuildPic
              row={row}
              display={row.unit ? buildpics?.[row.unit] : undefined}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{row.label}</span>
              <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                {row.member}
              </span>
            </span>
            {row.openedAs ? (
              <Badge variant="ghost" className="shrink-0 text-[0.625rem]">
                Already open
              </Badge>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The unit's build pic, or why there is not one.
 *
 * A model no unitdef names has no unit to have a pic, which is not the same as a
 * unit whose game ships none, so it says so with the builder's own mark rather
 * than borrowing `buildPicMissing`'s wording about a game shipping nothing.
 */
function BuildPic({
  row,
  display,
}: {
  row: GameModelRow;
  display?: { name?: string };
}) {
  const src = row.unit ? unitIconSrc(display) : undefined;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-9 shrink-0 rounded bg-muted object-contain"
      />
    );
  }
  if (!row.unit) {
    return (
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
        title="No unit in this game is drawn with this model, so it is a feature, a wreck or something else the game places itself."
      >
        <Blocks className="size-4" />
      </span>
    );
  }
  const missing = buildPicMissing(display);
  return (
    <span
      className="flex size-9 shrink-0 flex-col items-center justify-center rounded bg-muted text-center text-[0.5625rem] leading-tight text-muted-foreground"
      title={missing.title}
    >
      <ImageOff className="size-3.5" />
      {missing.label}
    </span>
  );
}

/** What the list is not showing, and why. Every one of these is a real state
 *  that would otherwise look like the picker being broken. */
function Footnotes({
  shown,
  matched,
  threeDoUnits,
  unresolved,
}: {
  shown: number;
  matched: number;
  threeDoUnits: number;
  unresolved: number;
}) {
  const notes: string[] = [];
  if (matched > shown) {
    notes.push(
      `Showing the first ${shown} of ${matched}. Search to narrow it down.`,
    );
  }
  if (threeDoUnits > 0) {
    notes.push(
      `${threeDoUnits} of this game's units are drawn with a .3do, an older model format the builder cannot read.`,
    );
  }
  if (unresolved > 0) {
    notes.push(
      `${unresolved} name a model this archive does not hold at all, usually one that lives in a game this one depends on.`,
    );
  }
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
      {notes.map((note) => (
        <p key={note} className="text-[0.6875rem] text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}
