import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { GameItem } from "../../bindings";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../../config";
import { BuildTreeDrawer } from "./BuildTreeDrawer";
import { FactionBuildList } from "./FactionBuildList";

/**
 * Embeds a game's build tree into a page — the engine behind the `@widget/build-tree`
 * and `@widget/faction-button` tokens (issue #274). `mode` picks the presentation:
 * "graph" drops the full multi-faction {@link BuildTreeDrawer} into a sized container;
 * "buttons" shows the per-faction buttons (each opening the drawer). Both resolve the
 * game — and its engine/dataDir/archive/sides/unit-dataset — from the active scan target,
 * so a distribution just names the game.
 *
 * `arg` names the game (exact name or shortname, case-insensitive); with no arg a
 * single-game install resolves to that one game. Every not-ready state (no engine,
 * scanning, unknown game, units still loading) shows a visible skeleton/notice rather
 * than a blank, matching the game-presence-via-unitsync rule (wait for the scan).
 */
export function BuildTreeEmbed({
  arg,
  mode,
}: {
  arg?: string;
  mode: "graph" | "buttons";
}) {
  const { selected } = useScanTargetSelection();
  const { data, loading: scanLoading } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const game = useMemo(() => pickGame(data?.games ?? [], arg), [data, arg]);
  const { info: gameInfo, loading: infoLoading } = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const startUnits = useMemo(
    () =>
      gameInfo
        ? Array.from(
            new Set(
              gameInfo.sides
                .map((s) => s.startUnit)
                .filter((u): u is string => !!u),
            ),
          )
        : [],
    [gameInfo],
  );
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    startUnits,
  );
  const { dataset } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  if (!selected)
    return <Notice>No engine selected to read the build tree.</Notice>;
  if (!data || scanLoading) return <EmbedSkeleton />;
  if (!game) {
    return (
      <Notice>
        {arg
          ? `Game not installed: ${arg}`
          : "Name a game: @widget/build-tree/<game>"}
      </Notice>
    );
  }
  if (infoLoading || !gameInfo) return <EmbedSkeleton />;

  if (mode === "buttons") {
    return (
      <FactionBuildList
        enginePath={selected.enginePath}
        dataDir={selected.rootPath}
        gameArchive={game.primaryArchive.name}
        gameName={game.name}
        sides={gameInfo.sides}
        units={dataset?.units ?? []}
        buildpics={buildpics}
      />
    );
  }
  return (
    <div className="my-3 h-[70vh] w-full overflow-hidden rounded-lg border border-border/50">
      <BuildTreeDrawer
        enginePath={selected.enginePath}
        dataDir={selected.rootPath}
        gameArchive={game.primaryArchive.name}
        sides={gameInfo.sides}
        units={dataset?.units ?? []}
        initialSide={gameInfo.sides[0]?.name ?? ""}
      />
    </div>
  );
}

/** Resolve the game to embed: exact name/shortname, then case-insensitive; a bare
 * (arg-less) token resolves only when the install has exactly one game. */
function pickGame(games: GameItem[], arg?: string): GameItem | undefined {
  if (!arg) return games.length === 1 ? games[0] : undefined;
  const lower = arg.toLowerCase();
  return (
    games.find((g) => g.name === arg) ??
    games.find((g) => g.info.shortname === arg) ??
    games.find((g) => g.name.toLowerCase() === lower) ??
    games.find((g) => g.info.shortname?.toLowerCase() === lower)
  );
}

function EmbedSkeleton() {
  return <Skeleton className="my-3 h-40 w-full rounded-lg" />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-md border border-dashed border-muted-foreground/40 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
