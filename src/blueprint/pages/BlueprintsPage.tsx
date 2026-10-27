/**
 * The blueprint library: every layout you have kept (issue #1415).
 *
 * A base blueprint is a shape rather than a place, so it belongs to you rather
 * than to one mission. Before this the only way to reach one was to open the
 * scenario that happened to contain it, which is exactly the binding splitting
 * the model was meant to remove.
 *
 * This follows the shape of the other libraries under Library: a grid of cards,
 * a filter, and a detail page behind each card. A layout names units by their
 * internal name, so it belongs to a game the way a scenario does, and the filter
 * is by game for the same reason.
 *
 * Making one happens here because a library is where a thing is made, and the
 * only choice a new layout needs is which game's units it is drawn from.
 */

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import {
  Blocks,
  FileDown,
  Flag,
  Gamepad2,
  Globe,
  Layers,
  Link2,
  ListOrdered,
  Package,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { GameItem } from "@/content/bindings";
import { useUnitsyncGameHeaders, useUnitsyncScan } from "@/content/config";
import {
  EmptyState,
  ErrorBanner,
  ScanFailed,
  SkeletonList,
} from "@/content/pages/components/states";
import { gameForIdentity } from "@/content/useGameUnits";
import { useImportParam } from "@/deeplink/useImportParam";
import { useRecordHubImport } from "@/hub/imports";
import { describeError } from "@/i18n/uiError";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { notify } from "@/notify/notify";
import { usePreferredTarget } from "@/play/config";
import { GamePickerField } from "@/play/pages/components/GamePickerButton";
import { countLine } from "../countLine";
import {
  type BlueprintSource,
  libraryGames,
  newStoredBlueprint,
  recordGameName,
  type StoredBlueprint,
  sourceLabel,
  uniqueLayoutName,
  untitled,
} from "../library";
import { blueprintRoute, saveBlueprint, useBlueprintLibrary } from "../store";
import { useWidgetFiles } from "../useWidgetFiles";
import { BlueprintCardMenu } from "./components/BlueprintCardMenu";
import { BlueprintImportButton } from "./components/BlueprintImportButton";
import { BlueprintPackButton } from "./components/BlueprintPackButton";
import { BlueprintPackWriteButton } from "./components/BlueprintPackWriteButton";
import { BlueprintWidgetButton } from "./components/BlueprintWidgetButton";
import { LayoutThumb } from "./components/LayoutThumb";

/** Every game, rather than one of them. A game's name is its archive name, so
 *  a bare word can never be one, and the select needs a value that is not the
 *  empty string. */
const ALL_GAMES = "every-game";

export default function BlueprintsPage() {
  const { records, loading, error } = useBlueprintLibrary();
  const { t } = useLingui();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installed = useMemo(
    () => withoutGeneratedGames(scan.data?.games ?? []),
    [scan.data],
  );
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    target?.enginePath,
    target?.dataDir,
  );
  const [game, setGame] = useState(ALL_GAMES);
  // A confirmed `coilbox://import` link carrying a blueprint code lands here,
  // because this is the only place a layout can be kept on its own. It names the
  // hub item it came from when the hub browse screen started it (issue #1368).
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();
  // The in game widget reads this library out of a file, and what it saves
  // comes back through another. Both kept in step while the page is up.
  useWidgetFiles();

  const games = useMemo(() => libraryGames(records), [records]);
  /** Every name in the library, which is what a new layout's name and a copy's
   *  are counted up past. */
  const names = useMemo(
    () => records.map((record) => record.layout.name),
    [records],
  );
  const shown = useMemo(
    () =>
      game === ALL_GAMES
        ? records
        : records.filter((record) => recordGameName(record) === game),
    [records, game],
  );

  const shownCount = shown.length;
  const totalCount = records.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title={t`Base blueprints`}
        description={t`Blueprints of buildings you can put down anywhere. A blueprint has no map and no team, so the same one works in a mission, in a skirmish, and in somebody else's game.`}
        actions={
          <>
            <BlueprintPackButton
              onImported={(kept) => {
                const firstName = kept[0]?.layout.name ?? "";
                const keptCount = kept.length;
                void notify({
                  title: plural(keptCount, {
                    one: `"${firstName}" is in your library.`,
                    other: "# blueprints are in your library.",
                  }),
                  level: "success",
                });
              }}
            />
            {records.length > 0 && (
              <BlueprintPackWriteButton
                onWritten={(said) =>
                  void notify({ title: said, level: "success" })
                }
              />
            )}
            <BlueprintWidgetButton
              onChanged={(said) =>
                void notify({ title: said, level: "success" })
              }
            />
            <BlueprintImportButton
              initialCode={importCode}
              hubItemId={hubItemId}
              onImported={(record) => {
                recordHubImport(
                  hubItemId,
                  [record.id],
                  blueprintRoute(record.id),
                );
                const keptName = record.layout.name;
                void notify({
                  title: t`"${keptName}" is in your library.`,
                  level: "success",
                });
              }}
            />
            <NewBlueprintButton
              games={installed}
              headers={gameHeaders}
              taken={names}
              scanning={scan.loading}
              scanError={scan.error}
            />
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      {scan.error && <ScanFailed noun={t`games`} reason={scan.error} />}

      {games.length > 1 && (
        <div className="flex items-center gap-2">
          <OptionSelect
            className="w-72"
            size="sm"
            value={game}
            onValueChange={setGame}
            options={[
              { value: ALL_GAMES, label: t`Every game` },
              ...games.map((name) => ({ value: name, label: name })),
            ]}
          />
          <span className="text-xs text-muted-foreground">
            <Trans>
              {shownCount} of {totalCount}
            </Trans>
          </span>
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : records.length === 0 ? (
        <EmptyState
          label={
            <Trans>
              No blueprints yet. A blueprint is a layout of buildings you draw
              once and place wherever you like: an opening, a wall, a factory
              corner. Make one with the button above, import one somebody
              shared, or open a pack: a file of layouts out of a game or off the
              community gallery.
            </Trans>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState label={t`No blueprints for ${game}.`} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {shown.map((record) => (
            <li key={record.id}>
              <BlueprintCard
                record={record}
                taken={names}
                installed={
                  !!scan.error ||
                  !recordGameName(record) ||
                  !!gameForIdentity(
                    installed,
                    recordGameName(record),
                    record.layout.game?.shortname,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One layout, drawn as it stands and named by what it is for.
 *
 * The name is the link and it covers the card, so anywhere on the card opens
 * the layout, and the menu beside it is the one place a press means something
 * else (issue #1477). A menu button inside the anchor would be a link that
 * sometimes is not one.
 */
function BlueprintCard({
  record,
  installed,
  taken,
}: {
  record: StoredBlueprint;
  /** False when this layout's game is not on this machine, which is why its
   *  buildings would be drawn as boxes if it were opened. */
  installed: boolean;
  /** Every name in the library, for the copy the menu makes. */
  taken: string[];
}) {
  const { t } = useLingui();
  const buildings = record.layout.buildings.length;
  const game = recordGameName(record);
  const buildingCount = countLine(
    buildings,
    record.layout.terrain?.length ?? 0,
  );

  return (
    <div className="relative flex h-full flex-col gap-2 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50 focus-within:border-primary/40">
      <div className="flex h-24 items-center justify-center">
        {buildings > 0 ? (
          <LayoutThumb layout={record.layout} />
        ) : (
          <Blocks className="size-6 text-muted-foreground" />
        )}
      </div>
      <Link
        to={blueprintRoute(record.id)}
        className="truncate text-sm font-medium after:absolute after:inset-0 after:rounded-lg"
      >
        {record.layout.name}
      </Link>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{buildingCount}</span>
        {record.layout.ordered && (
          <span className="flex items-center gap-1">
            <ListOrdered className="size-3.5" aria-hidden="true" />
            <Trans>build order</Trans>
          </span>
        )}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {game || t`No game named`}
      </span>
      {/* Where it came from, so a layout out of somebody's collection does not
          look identical to one you drew (issues #1313, #1473). */}
      {record.source && <SourceLine source={record.source} />}
      {!installed && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          <Trans>That game is not installed here.</Trans>
        </span>
      )}

      {/* Above the link's own cover, so the menu is reachable by pointer as
          well as by tab. */}
      <div className="absolute right-1 top-1 z-10">
        <BlueprintCardMenu record={record} taken={taken} />
      </div>
    </div>
  );
}

/** The mark each way in gets, so a glance tells a pack apart from a code
 *  without reading the line (issue #1473). */
const SOURCE_ICONS = {
  pack: Layers,
  // The mark the setup pack's own export button wears.
  "setup-pack": Package,
  file: FileDown,
  code: Link2,
  hub: Globe,
  scenario: Flag,
  widget: Gamepad2,
} as const;

/** Where one copy came from, in a line. The title is the fuller fact, which is
 *  a path for a file and the item's own id for a hub import: too long for a
 *  card, and the thing you need when you go looking for it again. */
function SourceLine({ source }: { source: BlueprintSource }) {
  const Icon = SOURCE_ICONS[source.kind];
  const detail =
    source.kind === "pack" || source.kind === "file"
      ? source.file
      : source.kind === "hub"
        ? source.item
        : undefined;
  return (
    <span
      title={detail}
      className="flex items-center gap-1 truncate text-xs text-muted-foreground"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {sourceLabel(source)}
    </span>
  );
}

/**
 * Make a new layout, which is a name and the game whose units it is drawn from.
 *
 * The game cannot be left until later: every building is picked from that
 * game's units, and the build grid a building snaps to comes out of them too.
 */
function NewBlueprintButton({
  games,
  headers,
  taken,
  scanning,
  scanError,
}: {
  games: GameItem[];
  /** Loading-screen art for the game picker, keyed by game name. */
  headers: Map<string, string>;
  /** The names already in the library, so a second "Untitled layout" is
   *  offered as "Untitled layout 2" rather than as a twin. */
  taken: string[];
  scanning: boolean;
  /** Why the scan could not list games, or null. */
  scanError: string | null;
}) {
  const navigate = useNavigate();
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [game, setGame] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = game || games[0]?.name || "";

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const made = newStoredBlueprint(
        uniqueLayoutName(name || untitled(), taken),
        pick,
        games,
      );
      await saveBlueprint(made);
      navigate(blueprintRoute(made.id));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="shrink-0 gap-1.5">
          <Plus className="size-4" /> <Trans>New blueprint</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="new-blueprint-name" className="text-xs font-medium">
            <Trans>Name</Trans>
          </label>
          <Input
            id="new-blueprint-name"
            value={name}
            placeholder={untitled()}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium">
            <Trans>Game</Trans>
          </span>
          <GamePickerField
            value={pick}
            onValueChange={setGame}
            games={games}
            headers={headers}
            placeholder={scanning ? t`Reading your games…` : t`Pick a game`}
            disabled={games.length === 0}
            gamesLoading={scanning}
          />
          <p className="text-xs text-muted-foreground">
            <Trans>
              A layout names its buildings by the game's own unit names, so it
              is drawn from one game's units.
            </Trans>
          </p>
        </div>

        {scanError && (
          <p className="text-xs text-destructive">
            <Trans>Your games could not be read: {scanError}</Trans>
          </p>
        )}
        {games.length === 0 && !scanning && !scanError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            <Trans>
              No games found. Install one under Library &gt; Games, then come
              back.
            </Trans>
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          className="w-full"
          disabled={busy || !pick}
          onClick={() => void create()}
        >
          <Trans>Make it</Trans>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
