import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import {
  FolderOpen,
  Plus,
  Puzzle,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import { SlideDrawer } from "@/components/SlideDrawer";
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
import { usePlay } from "@/play/PlayProvider";
import { useGameFiles } from "../useGameFiles";
import { useWidgetList } from "../useWidgetList";
import { folderToOpen, rowsForGame, type WidgetRow } from "../widgetList";
import {
  appliedSet,
  dropOverride,
  entry,
  setKey,
  switchIn,
  updateSets,
  useWidgetSets,
  type WidgetStates,
} from "../widgetSets";
import { AddWidgetDrawer } from "./AddWidgetDrawer";
import {
  RemovedNotice,
  type RemovedWidget,
  RemoveWidgetButton,
} from "./RemoveWidget";
import { type SettingsTarget, WidgetSettingsDrawer } from "./WidgetSettings";

/** The picker's value for the list of every widget file. Not empty, because
 *  the select treats an empty value as nothing picked. */
const ALL = "all-games";

/**
 * Library > Widgets (issue #1284): the widget files a player has added under
 * the engine's write folder, what each one declares, and which installed games
 * load it. `?game=` picks one game, which is how a game's page links here.
 *
 * Its switches change the widget sets (#4844): with "All games" picked, the set
 * every game uses, and with a game picked, that game's own set, which it gets
 * on its first change.
 */
export default function WidgetsPage() {
  const { t } = useLingui();
  const [params, setParams] = useSearchParams();
  const list = useWidgetList();
  const picked = params.get("game") ?? ALL;
  const game = list.games?.find((g) => g.game === picked);
  const files = useGameFiles(list.writeDir, list.games, list.rows);
  const sets = useWidgetSets();
  const [adding, setAdding] = useState(false);
  const [removed, setRemoved] = useState<RemovedWidget | null>(null);
  const { running } = usePlay();
  const reread = () => {
    void list.reload();
    void files.reload();
  };
  const file = game ? files.files?.get(game.game) : undefined;
  // A game whose handler is not recognised has no file to write, so no set.
  const key = game?.handler ? setKey(game) : null;
  const ownSet = key !== null && !!entry(sets.overrides, key);
  const [settingsPath, setSettingsPath] = useState<string | null>(null);

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

  const pick = (value: string) => {
    setSettingsPath(null);
    setParams(value === ALL ? {} : { game: value }, { replace: true });
  };

  /** What the settings drawer shows, when a row of the picked game is open. */
  const settingsTarget = useMemo((): SettingsTarget | null => {
    const row = shown?.find((r) => r.path === settingsPath);
    if (!row || !game?.handler) return null;
    const sw = settingsSwitch(row, game.game);
    return sw
      ? {
          row,
          sw,
          game: game.game,
          shortName: game.shortName,
          handler: game.handler,
        }
      : null;
  }, [shown, settingsPath, game]);

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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding(true)}
                disabled={
                  !list.games || !list.widgets || (picked !== ALL && !game)
                }
              >
                <Plus />
                <Trans>Add widget</Trans>
              </Button>
              <Button variant="outline" size="sm" onClick={openFolder}>
                <FolderOpen />
                <Trans>Open folder</Trans>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void list.reload();
                  void files.reload();
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

      {removed && list.writeDir && (
        <RemovedNotice
          removed={removed}
          writeDir={list.writeDir}
          onRestored={() => {
            setRemoved(null);
            reread();
          }}
          onDismiss={() => setRemoved(null)}
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

      {file?.kind === "error" && <ErrorBanner message={file.error} />}
      {picked === ALL &&
        [...(files.files ?? [])].map(
          ([name, f]) =>
            f.kind === "error" && (
              <ErrorBanner key={name} message={`${name}: ${f.error}`} />
            ),
        )}
      {game && file?.kind === "missing" && (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>
            {game.game} has not saved its widget settings yet, so these apply
            from the launch after it first does.
          </Trans>
        </p>
      )}
      {game && key !== null && ownSet && (
        <div className="flex items-center gap-3">
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>
              {game.game} uses its own widgets, not the ones for all games.
            </Trans>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateSets((s) => dropOverride(s, key))}
          >
            <Trans>Use the widgets for all games</Trans>
          </Button>
        </div>
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
            onSettings={
              game?.handler ? (row) => setSettingsPath(row.path) : undefined
            }
            canSettings={(row) => !!game && !!settingsSwitch(row, game.game)}
            renderRemove={
              list.writeDir && list.games && shown
                ? (row) => (
                    <RemoveWidgetButton
                      row={row}
                      rows={list.rows ?? []}
                      games={list.games ?? []}
                      writeDir={list.writeDir ?? ""}
                      running={running}
                      onRemoved={(done) => {
                        setRemoved(done);
                        setSettingsPath(null);
                        reread();
                      }}
                    />
                  )
                : undefined
            }
            switches={
              picked === ALL
                ? {
                    game: null,
                    set: sets.global,
                    toggle: (name, on) =>
                      updateSets((s) => switchIn(s, null, name, on)),
                  }
                : game && key !== null
                  ? {
                      game: game.game,
                      set: appliedSet(sets, key),
                      toggle: (name, on) =>
                        updateSets((s) => switchIn(s, key, name, on)),
                    }
                  : undefined
            }
          />
        )
      )}
      <SlideDrawer
        open={adding}
        title={t`Add a widget`}
        onClose={() => setAdding(false)}
      >
        {list.writeDir && list.games && list.widgets && (
          <AddWidgetDrawer
            writeDir={list.writeDir}
            games={list.games}
            caseSensitive={list.widgets.caseSensitive}
            game={game}
            setKey={picked === ALL ? null : key}
            onAdded={() => {
              void list.reload();
              void files.reload();
            }}
          />
        )}
      </SlideDrawer>
      <WidgetSettingsDrawer
        target={settingsTarget}
        writeDir={list.writeDir}
        onClose={() => setSettingsPath(null)}
      />
    </div>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** What the table needs to show a switch on each widget in one set. */
interface TableSwitches {
  /** The game shown, or null for the set every game uses. */
  game: string | null;
  /** The set shown. A widget it says nothing about is off. */
  set: WidgetStates;
  toggle: (name: string, on: boolean) => void;
}

/** The name a row's switch sets, when it has a switch: its saved name is
 *  certain (#1290) and, with a game shown, the game loads it. */
function switchName(row: WidgetRow, game: string | null): string | null {
  if (row.switch.kind !== "ready") return null;
  if (game !== null && !row.loadedBy.includes(game)) return null;
  return row.switch.name;
}

/** The switch of a row whose saved settings can be shown for `game`: it has a
 *  certain saved name and the game loads it. */
function settingsSwitch(
  row: WidgetRow,
  game: string,
): SettingsTarget["sw"] | null {
  if (row.switch.kind !== "ready" || !row.loadedBy.includes(game)) return null;
  return row.switch;
}

function RowSwitch({
  row,
  switches,
}: {
  row: WidgetRow;
  switches: TableSwitches;
}) {
  const { t } = useLingui();
  const name = switchName(row, switches.game);
  if (name === null) return null;
  return (
    <Switch
      checked={switches.set[name] === true}
      onCheckedChange={(on) => switches.toggle(name, on)}
      aria-label={t`${name} on`}
    />
  );
}

/** A field the widget's `GetInfo()` gave, shown as written. A file that could
 *  not be read (`known` false) says nothing either way, so its cell stays
 *  blank; its error is already on the row. */
function Declared({
  value,
  known,
  missing,
}: {
  value: string | null | undefined;
  known: boolean;
  missing: string;
}) {
  if (value?.trim()) return <>{value}</>;
  if (!known) return null;
  return <span className="text-muted-foreground">{missing}</span>;
}

function WidgetTable({
  rows,
  showGames,
  someUnknown,
  switches,
  onSettings,
  canSettings,
  renderRemove,
}: {
  rows: readonly WidgetRow[];
  showGames: boolean;
  /** Some installed game's handler is not recognised, so a file no recognised
   *  game loads may still load in that one. */
  someUnknown: boolean;
  /** Absent for a game whose handler is not recognised. */
  switches?: TableSwitches;
  /** Present with a recognised game picked. */
  onSettings?: (row: WidgetRow) => void;
  canSettings: (row: WidgetRow) => boolean;
  /** The remove button for a row. Not offered for coilbox's own widget. */
  renderRemove?: (row: WidgetRow) => ReactNode;
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
          {onSettings && (
            <TableHead className="w-0">
              <span className="sr-only">
                <Trans>Settings</Trans>
              </span>
            </TableHead>
          )}
          {renderRemove && (
            <TableHead className="w-0">
              <span className="sr-only">
                <Trans>Remove</Trans>
              </span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.path} className="align-top">
            {switches && (
              <TableCell>
                <RowSwitch row={row} switches={switches} />
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
              <Declared
                value={row.info?.author}
                known={!!row.info}
                missing={t`No author stated`}
              />
            </TableCell>
            <TableCell className="whitespace-normal">
              <Declared
                value={row.info?.license}
                known={!!row.info}
                missing={t`No licence stated`}
              />
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
            {onSettings && (
              <TableCell>
                {canSettings(row) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSettings(row)}
                    aria-label={t`Settings of ${row.info?.name || fileName(row.path)}`}
                  >
                    <SlidersHorizontal />
                    <Trans>Settings</Trans>
                  </Button>
                )}
              </TableCell>
            )}
            {renderRemove && (
              <TableCell>{!row.coilbox && renderRemove(row)}</TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
