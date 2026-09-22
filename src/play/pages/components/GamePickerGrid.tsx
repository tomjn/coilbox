import { Input } from "@picoframe/frame";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { useBrandingEntry, useBrandingImage } from "@/content/branding";
import { isSdd } from "@/content/format";
import { GameCardShell } from "@/content/pages/components/GameCardShell";
import { getGameMatcher } from "@/profile/profile";

/** Unique id for a game: its name plus its own primary archive (matches GamesPage). */
const gameId = (g: GameItem) => `${g.primaryArchive.name}:${g.name}`;

/**
 * One picker tile: the shared {@link GameCardShell} wrapped in a stretched select
 * button. A component (not an inline call) so the branding hooks run per game
 * without breaking the rules of hooks in the map.
 */
function GameTile({
  game,
  headers,
  selected,
  onSelect,
}: {
  game: GameItem;
  headers: Map<string, string>;
  selected: boolean;
  onSelect: () => void;
}) {
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner, true);
  return (
    <GameCardShell
      name={game.name}
      title={brand?.title ?? game.name}
      artUrl={brandBanner ?? headers.get(game.name)}
      alt={`${game.name} loading screen`}
      version={game.info.version}
      sdd={isSdd(game.primaryArchive)}
      warnings={game.warnings}
      selected={selected}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={game.name}
        aria-pressed={selected}
        className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      />
    </GameCardShell>
  );
}

/**
 * A searchable grid of game tiles, the picker's guts, with no opinion about
 * what it sits in (issue #2995). `GamePickerDrawer` wraps it in its own sheet
 * for a page, and a form already inside a drawer swaps its content for it, the
 * way `MapPickerGrid` is used (issue #2796).
 */
export function GamePickerGrid({
  games,
  headers,
  selectedName,
  onSelect,
  gamesLoading,
}: {
  games: readonly GameItem[];
  /** Batched loading-screen art keyed by game name. A game without any shows
   *  the gradient. */
  headers: Map<string, string>;
  selectedName: string;
  onSelect: (name: string) => void;
  /** The game list is still being scanned, so an empty grid means "not loaded
   *  yet" rather than "no games installed". */
  gamesLoading?: boolean;
}) {
  const [query, setQuery] = useState("");
  // A distribution profile can preset a game filter. When it does, the picker
  // only offers that game (matched on name). No profile offers every game.
  const scoped = useMemo(() => {
    const match = getGameMatcher();
    return match ? games.filter((g) => match(g.name)) : games;
  }, [games]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.primaryArchive.name.toLowerCase().includes(q),
    );
  }, [scoped, query]);

  let empty = `No games match “${query}”.`;
  if (scoped.length === 0)
    empty = gamesLoading ? "Reading your games…" : "No games are installed.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pb-1 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${scoped.length} games…`}
            aria-label="Search games"
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 content-start gap-3">
          {filtered.map((g) => (
            <GameTile
              key={gameId(g)}
              game={g}
              headers={headers}
              selected={g.name === selectedName}
              onSelect={() => onSelect(g.name)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">
              {empty}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
