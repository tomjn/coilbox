/**
 * The blueprint library: every layout you have kept (issue #1415).
 *
 * A base blueprint is a shape rather than a place, so it belongs to you rather
 * than to one mission. Before this the only way to reach one was to open the
 * scenario that happened to contain it, which is exactly the binding splitting
 * the model was meant to remove.
 *
 * This follows the shape of the other libraries under Content: a grid of cards,
 * a filter, and a detail page behind each card. A layout names units by their
 * internal name, so it belongs to a game the way a scenario does, and the filter
 * is by game for the same reason.
 *
 * Making one happens here because a library is where a thing is made, and the
 * only choice a new layout needs is which game's units it is drawn from.
 */

import { Button, Input } from "@picoframe/frame";
import { Blocks, ListOrdered, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUnitsyncScan } from "@/content/config";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "@/content/pages/components/states";
import { usePreferredTarget } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  libraryGames,
  newStoredBlueprint,
  recordGameName,
  type StoredBlueprint,
  UNTITLED,
  uniqueLayoutName,
} from "../library";
import { saveBlueprint, useBlueprintLibrary } from "../store";
import { LayoutThumb } from "./components/LayoutThumb";

/** Where one layout is edited. */
export function blueprintRoute(id: string): string {
  return `/content/blueprints/${encodeURIComponent(id)}`;
}

/** Every game, rather than one of them. A game's name is its archive name, so
 *  a bare word can never be one, and the select needs a value that is not the
 *  empty string. */
const ALL_GAMES = "every-game";

export default function BlueprintsPage() {
  const { records, loading, error } = useBlueprintLibrary();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installed = useMemo(() => scan.data?.games ?? [], [scan.data]);
  const [game, setGame] = useState(ALL_GAMES);

  const games = useMemo(() => libraryGames(records), [records]);
  const shown = useMemo(
    () =>
      game === ALL_GAMES
        ? records
        : records.filter((record) => recordGameName(record) === game),
    [records, game],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Base blueprints</h1>
          <p className="text-sm text-muted-foreground">
            Layouts of buildings you can put down anywhere. A blueprint has no
            map and no team, so the same one works in a mission, in a skirmish,
            and in somebody else's game.
          </p>
        </div>
        <NewBlueprintButton
          games={installed}
          taken={records.map((record) => record.layout.name)}
          scanning={scan.loading}
        />
      </header>

      {error && <ErrorBanner message={error} />}

      {games.length > 1 && (
        <div className="flex items-center gap-2">
          <OptionSelect
            className="w-72"
            size="sm"
            value={game}
            onValueChange={setGame}
            options={[
              { value: ALL_GAMES, label: "Every game" },
              ...games.map((name) => ({ value: name, label: name })),
            ]}
          />
          <span className="text-xs text-muted-foreground">
            {shown.length} of {records.length}
          </span>
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : records.length === 0 ? (
        <EmptyState
          label={
            <>
              No blueprints yet. A blueprint is a layout of buildings you draw
              once and place wherever you like: an opening, a wall, a factory
              corner. Make one with the button above, or bring one in from a
              game's own blueprint file in the scenario builder.
            </>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState label={`No blueprints for ${game}.`} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {shown.map((record) => (
            <li key={record.id}>
              <BlueprintCard
                record={record}
                installed={
                  !recordGameName(record) ||
                  installed.some((g) => g.name === recordGameName(record))
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One layout, drawn as it stands and named by what it is for. */
function BlueprintCard({
  record,
  installed,
}: {
  record: StoredBlueprint;
  /** False when this layout's game is not on this machine, which is why its
   *  buildings would be drawn as boxes if it were opened. */
  installed: boolean;
}) {
  const buildings = record.layout.buildings.length;
  const game = recordGameName(record);

  return (
    <Link
      to={blueprintRoute(record.id)}
      className="flex h-full flex-col gap-2 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
    >
      <div className="flex h-24 items-center justify-center">
        {buildings > 0 ? (
          <LayoutThumb layout={record.layout} />
        ) : (
          <Blocks className="size-6 text-muted-foreground" />
        )}
      </div>
      <span className="truncate text-sm font-medium">{record.layout.name}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {buildings} building{buildings === 1 ? "" : "s"}
        </span>
        {record.layout.ordered && (
          <span className="flex items-center gap-1">
            <ListOrdered className="size-3.5" aria-hidden="true" />
            build order
          </span>
        )}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {game || "No game named"}
      </span>
      {!installed && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          That game is not installed here.
        </span>
      )}
    </Link>
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
  taken,
  scanning,
}: {
  games: { name: string; info: Record<string, string> }[];
  /** The names already in the library, so a second "Untitled layout" is
   *  offered as "Untitled layout 2" rather than as a twin. */
  taken: string[];
  scanning: boolean;
}) {
  const navigate = useNavigate();
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
        uniqueLayoutName(name || UNTITLED, taken),
        pick,
        games,
      );
      await saveBlueprint(made);
      navigate(blueprintRoute(made.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="shrink-0 gap-1.5">
          <Plus className="size-4" /> New blueprint
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="new-blueprint-name" className="text-xs font-medium">
            Name
          </label>
          <Input
            id="new-blueprint-name"
            value={name}
            placeholder={UNTITLED}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium">Game</span>
          <OptionSelect
            value={pick}
            onValueChange={setGame}
            placeholder={scanning ? "Reading your games…" : "Pick a game"}
            disabled={games.length === 0}
            options={games.map((g) => ({ value: g.name, label: g.name }))}
          />
          <p className="text-xs text-muted-foreground">
            A layout names its buildings by the game's own unit names, so it is
            drawn from one game's units.
          </p>
        </div>

        {games.length === 0 && !scanning && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No games found. Install one under Content, then come back.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          className="w-full"
          disabled={busy || !pick}
          onClick={() => void create()}
        >
          Make it
        </Button>
      </PopoverContent>
    </Popover>
  );
}
