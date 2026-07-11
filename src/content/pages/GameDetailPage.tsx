import { Button, useDrawer } from "@picoframe/frame";
import { FolderOpen } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { type Archive, contentOpenPath } from "../bindings";
import { useBrandingEntry } from "../branding";
import { buildEdgeMap, reachableCounts } from "../buildTree";
import {
  classifyArchive,
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../config";
import { isSdd } from "../format";
import { usePlayGame } from "../usePlayGame";
import { ArchiveRow } from "./components/ArchiveRow";
import { BrandingLinks } from "./components/BrandingLinks";
import { BrandingScreenshots } from "./components/BrandingScreenshots";
import { BuildTreeDrawer } from "./components/BuildTreeDrawer";
import { GameHeader } from "./components/GameHeader";
import { OptionsList } from "./components/OptionsList";
import {
  DetailError,
  DetailLoading,
  NotFound,
  WarningBanner,
} from "./components/states";

/** Keys surfaced in the headline; everything else goes in the metadata table. */
const HEADLINE_KEYS = new Set(["name", "shortname", "version", "description"]);

/**
 * A single game: its metadata, its own (primary) archive, the archives it depends
 * on, and the full modinfo key/value set.
 */
export default function GameDetailPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const playGame = usePlayGame();
  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const game = data?.games.find((g) => g.name === decoded);
  const { info: gameInfo, loading: gameInfoLoading } = useUnitsyncGameInfo(
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
  // The reusable unit graph (units + buildoptions edges) backs both the per-side
  // unit counts below and the build-tree drawer. Fetched on demand when this page
  // opens — never during the scan.
  const { dataset } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const drawer = useDrawer();
  const buildEdges = useMemo(
    () => buildEdgeMap(dataset?.units ?? []),
    [dataset],
  );
  const sideUnitCounts = useMemo(
    () => reachableCounts(gameInfo?.sides ?? [], buildEdges),
    [gameInfo, buildEdges],
  );
  const brand = useBrandingEntry(game);

  if (error && !data)
    return (
      <DetailError
        backTo="/content/games"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/games" />;
  if (!game) return <NotFound backTo="/content/games" label="game" />;

  const otherInfo = Object.entries(game.info).filter(
    ([k]) => !HEADLINE_KEYS.has(k),
  );

  const openFolder = (a: Archive) => {
    if (!a.path) return;
    // A .sdd path is the folder itself; otherwise open the containing folder.
    const target = isSdd(a) ? a.path : a.path.replace(/[\\/][^\\/]*$/, "");
    contentOpenPath({ path: target }).catch(() => {});
  };

  // Open the per-faction build-tree drawer, starting on the clicked side.
  const openBuildTree = (sideName: string) => {
    if (!selected?.enginePath || !selected.rootPath || !gameInfo) return;
    drawer.open({
      title: `${game.name} — Build tree`,
      description:
        "Units each faction's commander can build, directly or indirectly.",
      width: "72rem",
      content: (
        <BuildTreeDrawer
          enginePath={selected.enginePath}
          dataDir={selected.rootPath}
          gameArchive={game.primaryArchive.name}
          sides={gameInfo.sides}
          units={dataset?.units ?? []}
          initialSide={sideName}
        />
      ),
    });
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <GameHeader
        game={game}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        onPlay={() => playGame(game.name)}
      />

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {game.info.shortname && (
            <span className="font-mono">{game.info.shortname}</span>
          )}
          {gameInfo?.checksum && (
            <span className="font-mono">checksum {gameInfo.checksum}</span>
          )}
        </div>
        {game.info.description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {game.info.description}
          </p>
        )}
      </div>

      {brand && <BrandingLinks entry={brand} />}
      {brand?.screenshots?.length ? (
        <BrandingScreenshots shots={brand.screenshots} />
      ) : null}

      {game.warnings?.length ? (
        <WarningBanner warnings={game.warnings} noun="game" />
      ) : null}

      {otherInfo.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Metadata</h2>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
            {otherInfo.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(gameInfoLoading || (gameInfo && gameInfo.sides.length > 0)) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            Sides
            {gameInfo && gameInfo.unitCount > 0
              ? ` · ${gameInfo.unitCount} units`
              : ""}
          </h2>
          {gameInfoLoading ? (
            <Skeleton className="h-12 rounded-lg border border-border/50 bg-card" />
          ) : (
            <ul className="flex flex-col gap-2">
              {gameInfo?.sides.map((s) => {
                const icon = s.startUnit
                  ? buildpics?.units[s.startUnit]?.icon
                  : undefined;
                // Prefer the unitdef's human name; fall back to the engine's
                // start-unit name, then the internal id.
                const unitLabel =
                  (s.startUnit && buildpics?.units[s.startUnit]?.name) ||
                  s.startUnitName ||
                  s.startUnit;
                // Units reachable from this faction's commander via buildoptions.
                // Omitted (and the card left inert) when the dataset is still
                // loading or the game exposes no buildoptions (0).
                const count = sideUnitCounts.get(s.name) ?? 0;
                return (
                  <li key={s.name}>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={count === 0}
                      onClick={() => openBuildTree(s.name)}
                      className="h-auto w-full justify-between gap-3 p-3"
                    >
                      <span className="flex items-center gap-3">
                        {icon && (
                          <img
                            src={icon}
                            alt=""
                            className="h-16 w-16 shrink-0 rounded object-contain"
                          />
                        )}
                        <span className="font-medium">{s.name}</span>
                      </span>
                      <span className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                        {count > 0 && <span>{count} units</span>}
                        {unitLabel && <span>{unitLabel}</span>}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <OptionsList options={gameInfo?.options ?? []} title="Game options" />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Primary archive</h2>
          {game.primaryArchive.path && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => openFolder(game.primaryArchive)}
            >
              <FolderOpen className="size-4" /> Open folder
            </Button>
          )}
        </div>
        <ul>
          <ArchiveRow archive={game.primaryArchive} />
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          Dependencies ({game.dependencyArchives.length})
        </h2>
        {game.dependencyArchives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This game depends on no other archives.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {game.dependencyArchives.map((a) => (
              <ArchiveRow
                key={a.name}
                archive={a}
                classification={classifyArchive(data, a.name)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
