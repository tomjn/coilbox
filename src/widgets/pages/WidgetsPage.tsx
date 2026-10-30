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
import { appFileIO } from "@/blueprint/fileIO";
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
import { errorText } from "@/lib/helpers";
import { usePlay } from "@/play/PlayProvider";
import { newConfigText } from "../gameHandler";
import { gameWidgetRows, gameWidgetStates, resetNames } from "../gameWidgets";
import { useGameFiles } from "../useGameFiles";
import { useGameWidgets } from "../useGameWidgets";
import { useWidgetList } from "../useWidgetList";
import { writeWidgetStates } from "../widgetConfig";
import { fileKey, fullPath } from "../widgetFiles";
import {
  findGame,
  folderToOpen,
  rowsForGame,
  type WidgetRow,
} from "../widgetList";
import { resetEntries } from "../widgetRemoval";
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
import { ResetGameWidgets } from "./ResetGameWidgets";
import { type SettingsTarget, WidgetSettingsDrawer } from "./WidgetSettings";

/** The picker's value for the list of every widget file. Not empty, because
 *  the select treats an empty value as nothing picked. */
const ALL = "all-games";

/**
 * Library > Widgets (issue #1284): the widget files a player has added under
 * `LuaUI/` of any content root and what each one declares. A row says so when
 * no installed game loads it. With more than one root, each row shows where its
 * file is.
 * `?game=` picks one game, by name or by the full name of one of its versions,
 * which is how a game's page links here.
 *
 * Its switches change the widget sets (#4844): with "All games" picked, the set
 * every game uses, and with a game picked, that game's own set, which it gets
 * on its first change.
 *
 * A picked game also lists the widgets it ships (#4857). Their switches write
 * the game's config file straight away, because no set holds them.
 */
export default function WidgetsPage() {
  const { t } = useLingui();
  const [params, setParams] = useSearchParams();
  const list = useWidgetList();
  const picked = params.get("game") ?? ALL;
  const game = findGame(list.games, picked);
  const files = useGameFiles(list.configDir, list.games, list.rows);
  const sets = useWidgetSets();
  const [adding, setAdding] = useState(false);
  // Every removal since the page opened, each with its own way back.
  const [removed, setRemoved] = useState<RemovedWidget[]>([]);
  const { running } = usePlay();
  const reread = () => {
    void list.reload();
    void files.reload();
  };
  const file = game ? files.files?.get(game.game) : undefined;
  // A game whose handler is not recognised has no file to write, so no set.
  const key = game?.handler ? setKey(game) : null;
  const ownSet = key !== null && !!entry(sets.overrides, key);
  const [settingsFile, setSettingsFile] = useState<string | null>(null);
  const own = useGameWidgets(
    list.enginePath,
    list.widgetDir,
    list.installed ?? [],
    game,
  );
  const [ownError, setOwnError] = useState<string | null>(null);
  const ownRows = useMemo(
    () =>
      game && own.widgets && list.rows
        ? gameWidgetRows(own.widgets, game, list.rows)
        : null,
    [game, own.widgets, list.rows],
  );
  const switchOwn = async (name: string, on: boolean) => {
    if (!game?.handler || !list.configDir) return;
    const { handler } = game;
    const { enginePath, widgetDir: dataDir } = list;
    const item = list.installed?.find(
      (g) => g.name === (game.versions?.[0] ?? game.game),
    );
    try {
      const out = await writeWidgetStates({
        io: appFileIO,
        writeDir: list.configDir,
        config: handler.config,
        shortName: game.shortName ?? "",
        states: new Map([[name, on]]),
        create:
          enginePath && dataDir && item
            ? () => newConfigText(enginePath, dataDir, item, handler)
            : undefined,
      });
      setOwnError(
        out ? null : t`Coilbox could not create ${game.game}'s settings file.`,
      );
    } catch (e) {
      setOwnError(errorText(e));
    }
    await files.reload();
  };
  const ownStates = useMemo(
    () =>
      ownRows && (file?.kind === "ready" || file?.kind === "missing")
        ? gameWidgetStates(
            ownRows,
            file.kind === "ready" ? file.order : new Map(),
          )
        : null,
    [ownRows, file],
  );
  // Only a widget the file has moved away from its default has anything to
  // reset. A game saves every widget it knows, so most entries match it.
  const ownChanged = useMemo(() => {
    if (!ownRows || !ownStates) return false;
    const defaults = gameWidgetStates(ownRows, new Map());
    return Object.keys(ownStates).some((n) => ownStates[n] !== defaults[n]);
  }, [ownRows, ownStates]);
  const resetOwn = async () => {
    if (!game?.handler || !list.configDir || !ownRows) return;
    await resetEntries({
      io: appFileIO,
      writeDir: list.configDir,
      game: { ...game, handler: game.handler },
      names: resetNames(ownRows, game.game, list.rows ?? []),
      gameRunning: running,
    });
    setOwnError(null);
    await files.reload();
  };

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
    setSettingsFile(null);
    setOwnError(null);
    setParams(value === ALL ? {} : { game: value }, { replace: true });
  };

  /** What the settings drawer shows, when a row of the picked game is open. */
  const settingsTarget = useMemo((): SettingsTarget | null => {
    const row = shown?.find((r) => fileKey(r) === settingsFile);
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
  }, [shown, settingsFile, game]);

  const openFolder = () => {
    if (!list.widgetDir) return;
    const folder = list.widgets
      ? folderToOpen(list.widgets, game?.handler)
      : null;
    const path = folder
      ? underConfigDir(list.widgetDir, folder)
      : list.widgetDir;
    contentOpenPath({ path }).catch(() => {});
  };

  const busy = !!list.widgetDir && ((!shown && !list.error) || list.reading);
  const columns: TableColumns = {
    on: picked === ALL || key !== null,
    settings: !!game?.handler && !!list.configDir,
    remove: !!list.widgetDir && !!list.configDir && !!list.games && !!shown,
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title={t`Widgets`}
        description={t`The widgets you have added to your games.`}
        actions={
          list.widgetDir && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding(true)}
                disabled={
                  !list.configDir ||
                  !list.games ||
                  !list.widgets ||
                  (picked !== ALL && !game)
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
          value={game?.game ?? picked}
          onValueChange={pick}
          options={options}
          ariaLabel={t`Game`}
        />
      )}

      {removed.map((r) => (
        <RemovedNotice
          key={r.backup}
          removed={r}
          onRestored={reread}
          onDismiss={() =>
            setRemoved((all) => all.filter((o) => o.backup !== r.backup))
          }
        />
      ))}

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

      {list.targets.length > 0 && (
        <WidgetTable
          columns={columns}
          showHeader={!!shown?.length || !!(game?.handler && ownRows?.length)}
        >
          <TableBody>
            {game?.handler && (
              <SectionHeading columns={columns}>
                <Trans>Your widgets</Trans>
              </SectionHeading>
            )}
            {busy ? (
              <SectionMessage columns={columns}>
                <SkeletonList />
              </SectionMessage>
            ) : shown && shown.length === 0 ? (
              <SectionMessage columns={columns}>
                <EmptyState
                  icon={Puzzle}
                  label={
                    game?.handler
                      ? t`${game.game} loads none of your widgets.`
                      : t`No widgets.`
                  }
                />
              </SectionMessage>
            ) : (
              shown && (
                <WidgetRows
                  rows={shown}
                  columns={columns}
                  flagUnloaded={!game && list.gamesKnown}
                  someUnknown={!!list.games?.some((g) => g.handler === null)}
                  showRoot={list.roots.length > 1}
                  onSettings={
                    columns.settings
                      ? (row) => setSettingsFile(fileKey(row))
                      : undefined
                  }
                  canSettings={(row) =>
                    !!game && !!settingsSwitch(row, game.game)
                  }
                  renderRemove={
                    columns.remove
                      ? (row) => (
                          <RemoveWidgetButton
                            row={row}
                            rows={list.rows ?? []}
                            games={list.games ?? []}
                            writeDir={list.configDir ?? ""}
                            running={running}
                            onRemoved={(done) => {
                              setRemoved((all) => [...all, done]);
                              setSettingsFile(null);
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
          </TableBody>
          {game?.handler && (
            <TableBody>
              <SectionHeading
                columns={columns}
                action={
                  ownChanged && (
                    <ResetGameWidgets
                      game={game.game}
                      running={running}
                      onReset={resetOwn}
                    />
                  )
                }
              >
                <Trans>{game.game}'s own widgets</Trans>
              </SectionHeading>
              {(own.errors.length > 0 || ownError) && (
                <SectionMessage columns={columns}>
                  <div className="flex flex-col gap-4">
                    {own.errors.map((e) => (
                      <ErrorBanner key={e} message={e} />
                    ))}
                    {ownError && <ErrorBanner message={ownError} />}
                  </div>
                </SectionMessage>
              )}
              {own.reading || (!ownRows && own.errors.length === 0) ? (
                <SectionMessage columns={columns}>
                  <SkeletonList />
                </SectionMessage>
              ) : ownRows && ownRows.length === 0 ? (
                <SectionMessage columns={columns}>
                  <EmptyState
                    icon={Puzzle}
                    label={t`${game.game} ships no widgets.`}
                  />
                </SectionMessage>
              ) : (
                ownRows && (
                  <WidgetRows
                    rows={ownRows}
                    columns={columns}
                    flagUnloaded={false}
                    someUnknown={false}
                    showRoot={false}
                    canSettings={() => false}
                    switches={
                      ownStates
                        ? {
                            game: game.game,
                            set: ownStates,
                            toggle: (name, on) => void switchOwn(name, on),
                            // The game saves its own file when it exits, over
                            // anything written while it runs.
                            disabled: running,
                          }
                        : undefined
                    }
                  />
                )
              )}
            </TableBody>
          )}
        </WidgetTable>
      )}
      <SlideDrawer
        open={adding}
        title={t`Add a widget`}
        onClose={() => setAdding(false)}
      >
        {list.widgetDir && list.configDir && list.games && list.widgets && (
          <AddWidgetDrawer
            widgetDir={list.widgetDir}
            writeDir={list.configDir}
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
        writeDir={list.configDir}
        onClose={() => setSettingsFile(null)}
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
  disabled?: boolean;
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
      disabled={switches.disabled}
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

/** The optional columns of the table, the same for every section of it. */
interface TableColumns {
  on: boolean;
  settings: boolean;
  remove: boolean;
}

function columnCount({ on, settings, remove }: TableColumns): number {
  return 3 + Number(on) + Number(settings) + Number(remove);
}

/** One table for a player's widgets and the game's own, so their columns line
 *  up whatever each section holds. */
function WidgetTable({
  columns,
  showHeader,
  children,
}: {
  columns: TableColumns;
  showHeader: boolean;
  children: ReactNode;
}) {
  return (
    <Table>
      {showHeader && (
        <TableHeader>
          <TableRow>
            {columns.on && (
              <TableHead className="w-0">
                <Trans>On</Trans>
              </TableHead>
            )}
            <TableHead className="w-full">
              <Trans>Widget</Trans>
            </TableHead>
            <TableHead className="w-0">
              <Trans>Version</Trans>
            </TableHead>
            <TableHead className="w-0">
              <Trans>Author</Trans>
            </TableHead>
            {columns.settings && (
              <TableHead className="w-0">
                <span className="sr-only">
                  <Trans>Settings</Trans>
                </span>
              </TableHead>
            )}
            {columns.remove && (
              <TableHead className="w-0">
                <span className="sr-only">
                  <Trans>Remove</Trans>
                </span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
      )}
      {children}
    </Table>
  );
}

function SectionHeading({
  columns,
  action,
  children,
}: {
  columns: TableColumns;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableHead
        scope="rowgroup"
        colSpan={columnCount(columns)}
        className="h-12 align-bottom text-sm font-medium"
      >
        <div className="flex items-center justify-between gap-2">
          {children}
          {action}
        </div>
      </TableHead>
    </TableRow>
  );
}

/** Something in place of a section's rows, as wide as the table. */
function SectionMessage({
  columns,
  children,
}: {
  columns: TableColumns;
  children: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columnCount(columns)} className="whitespace-normal">
        {children}
      </TableCell>
    </TableRow>
  );
}

function WidgetRows({
  rows,
  columns,
  flagUnloaded,
  someUnknown,
  showRoot,
  switches,
  onSettings,
  canSettings,
  renderRemove,
}: {
  rows: readonly WidgetRow[];
  columns: TableColumns;
  /** Say so on a row that no game loads. */
  flagUnloaded: boolean;
  /** More than one content root is read, so each row says which it is in. */
  showRoot: boolean;
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
    <>
      {rows.map((row) => (
        <TableRow key={fileKey(row)} className="align-top">
          {columns.on && (
            <TableCell>
              {switches && <RowSwitch row={row} switches={switches} />}
            </TableCell>
          )}
          <TableCell className="whitespace-normal">
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
              {showRoot ? fullPath(row) : row.path}
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
            {flagUnloaded && row.loadedBy.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {someUnknown ? (
                  <Trans>No game coilbox recognises loads this.</Trans>
                ) : (
                  <Trans>No installed game loads this.</Trans>
                )}
              </p>
            )}
          </TableCell>
          <TableCell>
            <div className="w-24 whitespace-normal [overflow-wrap:anywhere]">
              {row.info?.version ?? ""}
            </div>
          </TableCell>
          <TableCell>
            <div className="w-48 whitespace-normal [overflow-wrap:anywhere]">
              <Declared
                value={row.info?.author}
                known={!!row.info}
                missing={t`No author stated`}
              />
            </div>
          </TableCell>
          {columns.settings && (
            <TableCell>
              {onSettings && canSettings(row) && (
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
          {columns.remove && (
            <TableCell>{!row.coilbox && renderRemove?.(row)}</TableCell>
          )}
        </TableRow>
      ))}
    </>
  );
}
