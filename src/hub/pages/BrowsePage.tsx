import { Button, Input, useDrawer } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Download,
  Globe,
  Loader2,
  Package2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useScanTargetSelection, useUnitsyncScan } from "@/content/config";
import { buildDeepLink } from "@/deeplink/build";
import { dispatchDeepLink } from "@/deeplink/bus";
import { EmptyState } from "@/downloads/pages/components/states";
import { getGameMatcher, getProfile } from "@/profile/profile";
import { isProfileHidden } from "../../profile/hidden";
import {
  describeItem,
  fetchHubItem,
  HUB_KINDS,
  type HubFilters,
  type HubItem,
  kindLabelPlural,
  kindsPlural,
} from "../api";
import {
  type BrowseResult,
  describePinnedGame,
  loadBrowsePage,
} from "../browse";
import { KindIcon } from "../components/KindIcon";
import { hubItemRoute, useHubUrl } from "../config";
import {
  type HubItemPresence,
  noteHubContainer,
  noteHubItem,
} from "../importRecord";
import { useHubItemPresence } from "../imports";
import { FilterCombobox } from "./components/FilterCombobox";
import { HeaderAccount } from "./components/HeaderAccount";

/**
 * Browse what other players have shared on Coilbox Hub (issue #1347), without
 * leaving coilbox and without an account: every read here is anonymous.
 *
 * Until now the only way in was a link somebody handed you, which means the
 * gallery only worked if you already knew what was on it. This is the same
 * gallery the website serves, over the same filters, so a player can go looking.
 *
 * This screen never imports anything itself. The button on a card fetches the
 * item's `container_url` and hands it to the deep-link handler as an
 * `import?url=` link: fetch under a byte cap, check what came back, then confirm
 * applying it. The handler drops its "may coilbox contact this host" step for a
 * URL on the configured hub (issue #1367), which is the one this page has been
 * reading from all along. Every other check it runs is unchanged.
 *
 * Filtering follows the website's shape rather than growing a row of boxes. Kind
 * is a set of chips, the search box is the API's `q`, and author and tag are set
 * by clicking them on a card - the API offers no list of what values exist, and
 * a page's worth of rows is not that list.
 *
 * A card says whether you already have the item and offers to open it instead
 * (issue #1368). The answer comes from `../importRecord.ts`, which keeps a
 * record of what each hub import produced, and checks that the produced thing
 * is still there before it says you have it.
 *
 * A card is a summary, so pressing its title opens the item's own page
 * (`./ItemPage.tsx`, issue #1366), which has room for the whole description and
 * imports without a dialog. Import stays on the card for somebody who has
 * already read enough here.
 *
 * Game and map need a way in that doesn't depend on the right card already being
 * on the page (issue #1357), so they get a combobox each, listing the games and
 * maps coilbox finds installed locally rather than asking a new hub endpoint. A
 * locally installed name will not always match what the hub carries, so the box
 * still accepts whatever is typed - the list is a shortcut into it, not the only
 * way in.
 *
 * The website the gallery is served from is a button in the header rather than a
 * sidebar entry: an external link sitting among the download sources would read
 * as another place to download from.
 *
 * A distribution that pins coilbox to its own game pins this list too (issue
 * #1362, applied in `../browse.ts`). The header says so, and the game box and the
 * cards' game chips go with it: the pin has already answered which game, so a
 * control offering to answer it again would be offering a choice that changes
 * nothing.
 */

/** How long to sit on a keystroke before asking the hub. Each search is a round
 * trip, so typing a word should not be eight of them. */
const SEARCH_DEBOUNCE_MS = 400;

/** The filters set by clicking a card, in the order the chips appear. */
const CLICKABLE = [
  { key: "game", label: "Game" },
  { key: "map", label: "Map" },
  { key: "author", label: "By" },
  { key: "tag", label: "Tag" },
] as const;

type ClickableKey = (typeof CLICKABLE)[number]["key"];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function BrowsePage() {
  const hubUrl = useHubUrl();
  const navigate = useNavigate();
  const presenceOf = useHubItemPresence();
  const [filters, setFilters] = useState<HubFilters>({ page: 1 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Typing is separate from the filter it eventually sets, so the list is not
  // refetched on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // The distribution's own game pin, if it set one. Read once: the profile is
  // loaded at startup and never changes, and a fresh predicate every render would
  // refetch the list every render.
  const pinnedMatcher = useMemo(() => getGameMatcher(), []);
  const pinnedGame = useMemo(
    () => describePinnedGame(getProfile().gameFilter),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadBrowsePage(hubUrl, filters, pinnedMatcher, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (result.ok) {
          setPage(result.value);
        } else {
          setPage(null);
          setError(result.reason);
        }
      },
    );
    return () => controller.abort();
  }, [hubUrl, filters, pinnedMatcher]);

  /** Ask the hub again after a failure. A fresh object with the same filters in
   * it is what re-runs the fetch, so there is no second reason to re-run it. */
  const retry = useCallback(() => setFilters((f) => ({ ...f })), []);

  const setFilter = useCallback((key: ClickableKey | "kind", value: string) => {
    setImportError(null);
    setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  }, []);

  // Games and maps installed locally, for the game/map filter suggestions. The
  // same scan the Games and Maps pages already run and cache, so opening this
  // page is a cache hit whenever the app's startup warm-up has already primed
  // the default engine. A game's/map's `name` (from modinfo/mapinfo) is already
  // "Name version", the same shape the hub stores its own values in.
  const { selected: scanTarget } = useScanTargetSelection();
  const { data: scanData } = useUnitsyncScan(
    scanTarget?.enginePath,
    scanTarget?.rootPath,
  );
  const installedGames = useMemo(
    () =>
      [...new Set((scanData?.games ?? []).map((g) => g.name))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [scanData],
  );
  const installedMaps = useMemo(
    () =>
      [...new Set((scanData?.maps ?? []).map((m) => m.name))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [scanData],
  );

  // Fetch the item for its container address, then hand that to the deep-link
  // handler. It shows what came back and asks before applying it, so nothing is
  // imported by pressing this.
  const importItem = useCallback(
    async (item: HubItem) => {
      setImporting(item.id);
      setImportError(null);
      const result = await fetchHubItem(hubUrl, item.id);
      setImporting(null);
      if (!result.ok) {
        setImportError(result.reason);
        return;
      }
      const link = buildDeepLink({
        kind: "import",
        source: { type: "url", url: result.value.container_url },
      });
      if (!link.ok) {
        setImportError(link.reason);
        return;
      }
      // Say which item this address belongs to before the link goes anywhere,
      // so the importer that finishes the job can record what it produced.
      noteHubContainer(result.value.container_url, item.id);
      // And what the hub says about it, so a layout imported from here can
      // record who published it (issue #1473).
      noteHubItem(item);
      dispatchDeepLink(link.url);
    },
    [hubUrl],
  );

  const drawer = useDrawer();
  const openExport = async () => {
    const { ExportPackForm } = await import(
      "../../packs/pages/components/ExportPackForm"
    );
    drawer.open({
      title: "Share a setup pack",
      width: "26rem",
      content: <ExportPackForm />,
    });
  };

  const active = useMemo(
    () => CLICKABLE.filter((f) => filters[f.key]?.trim()),
    [filters],
  );

  const lastPage = page?.lastPage ?? 1;
  const current = page?.page ?? filters.page ?? 1;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold leading-none">Coilbox hub</h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              {/* Built from the kinds the chips below offer, so the sentence
                  cannot say four when there are five (issue #1502). */}
              {kindsPlural()} shared by other players. Importing needs no
              account, and nothing is imported until you have seen what it is
              and said yes.
            </p>
            {pinnedMatcher && (
              <p className="max-w-prose text-sm text-muted-foreground">
                This copy of Coilbox is set up for {pinnedGame ?? "one game"},
                so the hub shows its things, plus anything not tied to a game.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <HeaderAccount hubUrl={hubUrl} />
            {!isProfileHidden("content.setupPacks") && (
              <Button variant="outline" size="sm" onClick={openExport}>
                <Package2 size={16} /> Share a pack
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openUrl(hubUrl)}
            >
              <CoilboxGlyph size={16} /> Hub website
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles and descriptions…"
              aria-label="Search the hub"
              className="h-9 pl-7"
            />
          </div>
          {!pinnedMatcher && (
            <FilterCombobox
              value={filters.game ?? ""}
              onCommit={(v) => setFilter("game", v)}
              options={installedGames}
              placeholder="Game"
              ariaLabel="Filter by game"
              className="h-9 w-36"
            />
          )}
          <FilterCombobox
            value={filters.map ?? ""}
            onCommit={(v) => setFilter("map", v)}
            options={installedMaps}
            placeholder="Map"
            ariaLabel="Filter by map"
            className="h-9 w-36"
          />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            value={filters.kind ?? ""}
            // Radix clears the value when the lit chip is pressed again, which
            // is how "all kinds" is chosen: there is no separate All chip.
            onValueChange={(v) => setFilter("kind", v)}
            aria-label="Kind"
          >
            {HUB_KINDS.map((kind) => (
              <ToggleGroupItem
                key={kind}
                value={kind}
                className="data-[state=on]:border-primary data-[state=on]:bg-primary/10"
              >
                {kindLabelPlural(kind)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {page && !loading && (
            <span className="text-sm text-muted-foreground">
              {page.total} {page.total === 1 ? "item" : "items"}
            </span>
          )}
        </div>
        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {active.map((f) => (
              <Button
                key={f.key}
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setFilter(f.key, "")}
              >
                {f.label}: {filters[f.key]}
                <X className="size-3" aria-hidden />
                <span className="sr-only">Clear this filter</span>
              </Button>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {importError && (
          <Alert variant="destructive" className="mb-3">
            <AlertCircle size={15} />
            <AlertDescription className="text-destructive">
              {importError}
            </AlertDescription>
          </Alert>
        )}
        {loading && (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> loading the hub…
          </p>
        )}
        {error && (
          <Alert variant="destructive" className="m-2">
            <AlertCircle size={15} />
            <AlertDescription className="flex flex-wrap items-center gap-3 text-destructive">
              {error}
              <Button variant="outline" size="sm" onClick={retry}>
                <RotateCw className="mr-1.5 size-3.5" aria-hidden /> Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!loading && !error && page && page.items.length === 0 && (
          <EmptyState icon={Globe}>
            {emptyReason(
              active.length > 0 || !!filters.kind || !!filters.q?.trim(),
              pinnedMatcher !== null,
              pinnedGame,
            )}
          </EmptyState>
        )}
        {!loading && page && page.items.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
            {page.items.map((item) => {
              const presence = presenceOf(item);
              return (
                <li
                  key={item.id}
                  // Three groups with room between them - what it is, what it is
                  // for, what to do about it - rather than five evenly spaced
                  // lines, which read as one undifferentiated block.
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20"
                >
                  <button
                    type="button"
                    className="group flex w-full flex-col gap-1.5 text-left"
                    onClick={() => navigate(hubItemRoute(item.id))}
                  >
                    <span
                      className="text-sm font-medium group-hover:underline"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                    {/* Under the title, and free to wrap. Beside each other on
                        one line, a narrow card squeezed the date until it broke
                        across three lines and set the row's height. */}
                    <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="secondary" className="gap-1">
                        <KindIcon kind={item.kind} mode={item.mode} />
                        {describeItem(item.kind, item.mode)}
                      </Badge>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(item.created_at)}
                      </span>
                    </span>
                    {item.description && (
                      <span className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </button>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {item.game_name &&
                      (pinnedMatcher ? (
                        <span className={CHIP_CLASS}>{item.game_name}</span>
                      ) : (
                        <FilterChip
                          label={item.game_name}
                          onClick={() =>
                            setFilter("game", item.game_name ?? "")
                          }
                        />
                      ))}
                    {item.map_name && (
                      <FilterChip
                        label={item.map_name}
                        onClick={() => setFilter("map", item.map_name ?? "")}
                      />
                    )}
                    <FilterChip
                      label={`by ${item.author_name}`}
                      onClick={() => setFilter("author", item.author_name)}
                    />
                    {item.tags.map((tag) => (
                      <FilterChip
                        key={tag}
                        label={`#${tag}`}
                        onClick={() => setFilter("tag", tag)}
                      />
                    ))}
                  </div>
                  <ItemActions
                    item={item}
                    presence={presence}
                    fetching={importing === item.id}
                    busy={importing !== null}
                    onImport={() => importItem(item)}
                    onOpen={(route) => navigate(route)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {!loading && page?.truncated && (
          <p className="mt-4 max-w-prose text-xs text-muted-foreground">
            Only the first {page.truncated.scanned} items on the hub were read,
            so there may be more for this game than are listed here. Search to
            narrow it down.
          </p>
        )}
        {!loading && page && lastPage > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={current <= 1}
              onClick={() =>
                setFilters((f) => ({ ...f, page: Math.max(1, current - 1) }))
              }
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {current} of {lastPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= lastPage}
              onClick={() => setFilters((f) => ({ ...f, page: current + 1 }))}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What a card offers, which depends on whether you already have the item
 * (issue #1368). Something already imported offers only Open. A second copy is
 * not a thing anybody asked for: an imported preset that has since been edited
 * is a new preset with no tie back to the hub item, so "import again" answered a
 * question nobody had. Somebody who does want a fresh copy can remove theirs
 * from the item's own page and import it.
 *
 * An item imported before and since deleted offers Import, and the card says
 * nothing about the history. It read as a third paragraph on a card that already
 * had a description, and a card is a summary. The item's own page has room to
 * say it, and does.
 */
function ItemActions({
  item,
  presence,
  fetching,
  busy,
  onImport,
  onOpen,
}: {
  item: HubItem;
  presence: HubItemPresence;
  /** This card's own fetch is in flight. */
  fetching: boolean;
  /** Some card's fetch is in flight, so no other one may start. */
  busy: boolean;
  onImport: () => void;
  onOpen: (route: string) => void;
}) {
  const importIcon = fetching ? (
    <Loader2 className="animate-spin" />
  ) : (
    <Download />
  );

  if (presence.state === "here") {
    return (
      // "Imported" sits with the button rather than up in the header, because
      // it is about what pressing it does, not about what the item is.
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpen(presence.route)}
          aria-label={`Open ${item.title}`}
        >
          <ArrowRight /> Open
        </Button>
        <Badge variant="outline" className="gap-1">
          <Check className="size-3" aria-hidden /> Imported
        </Badge>
      </div>
    );
  }

  return (
    <div className="mt-auto flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onImport}
        disabled={busy}
        aria-label={`Import ${item.title}`}
      >
        {importIcon}
        {fetching ? "Fetching…" : "Import"}
      </Button>
    </div>
  );
}

/**
 * Why the list is empty, in the reader's terms. A distribution that pinned the
 * hub to its own game is the likeliest reason a hub with things on it looks
 * bare, so it is worth saying rather than leaving "nothing here" to be read as a
 * dead service.
 */
function emptyReason(
  filtered: boolean,
  pinned: boolean,
  pinnedGame: string | null,
): string {
  if (filtered) return "Nothing on the hub matches those filters yet.";
  if (pinned) {
    return `The hub has nothing for ${pinnedGame ?? "this game"} yet. This copy of Coilbox lists only that game's things, so there may be other games' things on the hub.`;
  }
  return "The hub has nothing on it yet. Anything you share will show up here.";
}

/** How a card's game, map, author and tag are drawn, pressable or not. */
const CHIP_CLASS =
  "rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground";

/** A card's game, map, author or tag, which filters the list when pressed. */
function FilterChip({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${CHIP_CLASS} transition-colors hover:border-foreground/30 hover:text-foreground`}
    >
      {label}
    </button>
  );
}
