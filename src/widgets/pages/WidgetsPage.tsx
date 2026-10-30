import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { FolderOpen, Puzzle, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contentOpenPath } from "@/content/bindings";
import { underConfigDir } from "@/content/enginePaths";
import { NoEngines } from "@/content/pages/components/BrowserToolbar";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "@/content/pages/components/states";
import { useWidgetList } from "../useWidgetList";
import { folderToOpen, rowsForGame, type WidgetRow } from "../widgetList";

/** The picker's value for the list of every widget file. Not empty, because
 *  the select treats an empty value as nothing picked. */
const ALL = "all-games";

/**
 * Library > Widgets (issue #1284): the widget files a player has added under
 * the engine's write folder, what each one declares, and which installed games
 * load it. `?game=` picks one game, which is how a game's page links here.
 */
export default function WidgetsPage() {
  const { t } = useLingui();
  const [params, setParams] = useSearchParams();
  const list = useWidgetList();
  const picked = params.get("game") ?? ALL;
  const game = list.games?.find((g) => g.game === picked);

  const shown = useMemo(() => {
    if (!list.rows) return null;
    return game ? rowsForGame(list.rows, game) : list.rows;
  }, [list.rows, game]);

  const options = useMemo(
    () => [
      { value: ALL, label: t`All games` },
      ...(list.games ?? []).map((g) => ({ value: g.game, label: g.game })),
      // A link can name a game that is not installed here, or not read yet.
      // Keep it pickable so the trigger shows what was asked for, rather than
      // going blank.
      ...(picked !== ALL && !game ? [{ value: picked, label: picked }] : []),
    ],
    [list.games, game, picked, t],
  );

  const pick = (value: string) =>
    setParams(value === ALL ? {} : { game: value }, { replace: true });

  const openFolder = () => {
    if (!list.writeDir) return;
    const folder = list.widgets
      ? folderToOpen(list.widgets, game?.handler)
      : null;
    const path = folder ? underConfigDir(list.writeDir, folder) : list.writeDir;
    contentOpenPath({ path }).catch(() => {});
  };

  const busy =
    list.locating ||
    (!!list.writeDir && ((!shown && !list.error) || list.reading));

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title={t`Widgets`}
        description={t`The widgets you have added to your games, and which games load each one.`}
        actions={
          list.writeDir && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={openFolder}>
                <FolderOpen />
                <Trans>Open folder</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.reload()}
                disabled={list.reading}
              >
                <RefreshCw />
                <Trans>Rescan</Trans>
              </Button>
            </div>
          )
        }
      />
      {list.targets.length === 0 && <NoEngines />}

      {list.targets.length > 0 && (
        <OptionSelect
          className="w-72"
          value={picked}
          onValueChange={pick}
          options={options}
          ariaLabel={t`Game`}
        />
      )}

      {list.error && <ErrorBanner message={list.error} />}
      {list.folderErrors.map((e) => (
        <ErrorBanner key={e} message={e} />
      ))}

      {game && game.handler === null && (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>
            Coilbox does not recognise {game.game}'s widget handler, so it
            cannot tell which of these the game loads.
          </Trans>
        </p>
      )}

      {list.targets.length === 0 ? null : !list.locating && !list.writeDir ? (
        <EmptyState
          icon={Puzzle}
          label={t`This engine does not say where it keeps its settings, so coilbox cannot find its widget folder.`}
        />
      ) : busy ? (
        <SkeletonList />
      ) : shown && shown.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          label={
            game?.handler
              ? t`${game.game} loads none of your widgets.`
              : t`No widgets.`
          }
        />
      ) : (
        shown && (
          <WidgetTable
            rows={shown}
            showGames={!game}
            someUnknown={!!list.games?.some((g) => g.handler === null)}
          />
        )
      )}
    </div>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function WidgetTable({
  rows,
  showGames,
  someUnknown,
}: {
  rows: readonly WidgetRow[];
  showGames: boolean;
  /** Some installed game's handler is not recognised, so a file no recognised
   *  game loads may still load in that one. */
  someUnknown: boolean;
}) {
  const { t } = useLingui();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans>Widget</Trans>
          </TableHead>
          <TableHead>
            <Trans>Version</Trans>
          </TableHead>
          <TableHead>
            <Trans>Author</Trans>
          </TableHead>
          <TableHead>
            <Trans>Licence</Trans>
          </TableHead>
          {showGames && (
            <TableHead>
              <Trans>Loaded by</Trans>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.path} className="align-top">
            <TableCell className="max-w-md whitespace-normal">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {row.info?.name || fileName(row.path)}
                </span>
                {row.coilbox && (
                  <Badge variant="secondary">
                    <Trans>Coilbox</Trans>
                  </Badge>
                )}
              </div>
              {row.info?.desc && (
                <p className="text-sm text-muted-foreground">{row.info.desc}</p>
              )}
              <p className="break-all font-mono text-xs text-muted-foreground">
                {row.path}
              </p>
              {row.error && (
                <p className="break-words text-xs text-destructive">
                  {t`Could not read: ${row.error}`}
                </p>
              )}
            </TableCell>
            <TableCell>{row.info?.version ?? ""}</TableCell>
            <TableCell className="whitespace-normal">
              {row.info?.author ?? ""}
            </TableCell>
            <TableCell className="whitespace-normal">
              {row.info?.license ?? ""}
            </TableCell>
            {showGames && (
              <TableCell className="whitespace-normal text-sm">
                {row.loadedBy.length > 0 ? (
                  row.loadedBy.join(", ")
                ) : (
                  <span className="text-muted-foreground">
                    {someUnknown ? (
                      <Trans>No game coilbox recognises</Trans>
                    ) : (
                      <Trans>No installed game</Trans>
                    )}
                  </span>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
