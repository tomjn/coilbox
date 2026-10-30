import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { FolderOpen, Puzzle, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { useWidgetSwitches } from "../useWidgetSwitches";
import { folderToOpen, rowsForGame, type WidgetRow } from "../widgetList";
import { savedUnder } from "../widgetNames";

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
  const switches = useWidgetSwitches(list.writeDir, game);

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
                onClick={() => {
                  void list.reload();
                  void switches.reload();
                }}
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

      {switches.error && <ErrorBanner message={switches.error} />}
      {game && switches.state.kind === "missing" && (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>
            {game.game} has not saved its widget settings yet. Start it once to
            switch widgets on or off here.
          </Trans>
        </p>
      )}
      {switches.state.kind === "ready" && switches.running && (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>Close the game to switch widgets on or off.</Trans>
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
            showGames={!game && list.gamesKnown}
            someUnknown={!!list.games?.some((g) => g.handler === null)}
            switches={
              switches.state.kind === "ready"
                ? {
                    game: picked,
                    order: switches.state.order,
                    disabled: switches.running,
                    writing: switches.writing,
                    toggle: (name, on) => void switches.toggle(name, on),
                  }
                : undefined
            }
          />
        )
      )}
    </div>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** What the table needs to show a switch on each widget of one game. */
interface TableSwitches {
  /** The game whose file it is. */
  game: string;
  /** The game's order table: `0` is off, anything else on. */
  order: ReadonlyMap<string, number>;
  disabled: boolean;
  /** The widget being written, whose switch waits for it. */
  writing: string | null;
  toggle: (name: string, on: boolean) => void;
}

/** The name a row's switch writes under, when it has a switch in this game:
 *  the game loads the file and its saved name is certain (#1290). */
function switchName(row: WidgetRow, game: string): string | null {
  if (row.switch.kind !== "ready" || !row.loadedBy.includes(game)) return null;
  return row.switch.name;
}

/** Whether the game loads a widget, from the entry its handler reads, or
 *  when it has none from what the widget declares, as the handler decides
 *  for a widget it has not seen. */
function isOn(row: WidgetRow, order: ReadonlyMap<string, number>): boolean {
  if (row.switch.kind !== "ready") return false;
  const saved = savedUnder(row.switch, (n) => order.has(n));
  return saved === null
    ? row.info?.enabled === true
    : (order.get(saved) ?? 0) > 0;
}

function WidgetTable({
  rows,
  showGames,
  someUnknown,
  switches,
}: {
  rows: readonly WidgetRow[];
  showGames: boolean;
  /** Some installed game's handler is not recognised, so a file no recognised
   *  game loads may still load in that one. */
  someUnknown: boolean;
  /** Set when one game is shown and its config file was read. */
  switches?: TableSwitches;
}) {
  const { t } = useLingui();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {switches && (
            <TableHead className="w-0">
              <Trans>On</Trans>
            </TableHead>
          )}
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
            {switches && (
              <TableCell>
                {switchName(row, switches.game) !== null && (
                  <Switch
                    checked={isOn(row, switches.order)}
                    disabled={switches.disabled || switches.writing !== null}
                    onCheckedChange={(on) =>
                      switches.toggle(switchName(row, switches.game) ?? "", on)
                    }
                    aria-label={t`${switchName(row, switches.game)} on`}
                  />
                )}
              </TableCell>
            )}
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
              {row.switch.kind === "none" &&
                row.switch.reason === "duplicate" && (
                  <p className="break-words text-xs text-destructive">
                    {t`Has the same name as ${row.switch.others.join(", ")}, so they share one setting.`}
                  </p>
                )}
              {row.switch.kind === "none" &&
                row.switch.reason === "experimental" && (
                  <p className="break-words text-xs text-muted-foreground">
                    {t`A game saves this under a name that depends on its version.`}
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
