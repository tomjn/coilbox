import { Button } from "@picoframe/frame";
import { FolderOpen } from "lucide-react";
import { useParams } from "react-router";
import { type Archive, contentOpenPath } from "../bindings";
import {
  classifyArchive,
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
} from "../config";
import { isSdd } from "../format";
import { usePlayGame } from "../usePlayGame";
import { ArchiveRow } from "./components/ArchiveRow";
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
            <div className="h-12 animate-pulse rounded-lg border border-border/50 bg-card" />
          ) : (
            <ul className="flex flex-col gap-2">
              {gameInfo?.sides.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3"
                >
                  <span className="font-medium">{s.name}</span>
                  {(s.startUnitName || s.startUnit) && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.startUnitName ?? s.startUnit}
                    </span>
                  )}
                </li>
              ))}
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
