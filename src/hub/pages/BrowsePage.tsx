import { Button, Input } from "@picoframe/frame";
import {
  AlertCircle,
  Download,
  Globe,
  Loader2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { buildDeepLink } from "@/deeplink/build";
import { dispatchDeepLink } from "@/deeplink/bus";
import { EmptyState } from "@/downloads/pages/components/states";
import {
  describeItem,
  fetchHubItem,
  fetchHubItems,
  HUB_KINDS,
  type HubFilters,
  type HubItem,
  type HubItemsPage,
  kindLabelPlural,
} from "../api";
import { useHubUrl } from "../config";

/**
 * Browse what other players have shared on Coilbox Hub (issue #1347), without
 * leaving coilbox and without an account: every read here is anonymous.
 *
 * Until now the only way in was a link somebody handed you, which means the
 * gallery only worked if you already knew what was on it. This is the same
 * gallery the website serves, over the same filters, so a player can go looking.
 *
 * Nothing about importing changes. The button on a card fetches the item's
 * `container_url` and hands it to the deep-link handler as an
 * `import?url=` link, which is exactly what a pasted hub address already does:
 * confirm contacting the host, fetch under a byte cap, check what came back,
 * then confirm applying it. This screen never imports anything itself.
 *
 * Filtering follows the website's shape rather than growing a row of boxes. Kind
 * is a set of chips, the search box is the API's `q`, and game, map, author and
 * tag are set by clicking them on a card - the API offers no list of what values
 * exist, and a page's worth of rows is not that list.
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
  const [filters, setFilters] = useState<HubFilters>({ page: 1 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<HubItemsPage | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchHubItems(hubUrl, filters, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.ok) {
        setPage(result.value);
      } else {
        setPage(null);
        setError(result.reason);
      }
    });
    return () => controller.abort();
  }, [hubUrl, filters]);

  /** Ask the hub again after a failure. A fresh object with the same filters in
   * it is what re-runs the fetch, so there is no second reason to re-run it. */
  const retry = useCallback(() => setFilters((f) => ({ ...f })), []);

  const setFilter = useCallback((key: ClickableKey | "kind", value: string) => {
    setImportError(null);
    setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  }, []);

  // Fetch the item for its container address, then hand that to the deep-link
  // handler. It asks before contacting the host and again before applying, so
  // nothing is imported by pressing this.
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
      dispatchDeepLink(link.url);
    },
    [hubUrl],
  );

  const active = useMemo(
    () => CLICKABLE.filter((f) => filters[f.key]?.trim()),
    [filters],
  );

  const lastPage = page
    ? Math.max(1, Math.ceil(page.total / Math.max(1, page.pageSize)))
    : 1;
  const current = filters.page ?? 1;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Community hub</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Presets, challenges, setup packs and scenarios shared by other
            players. Importing needs no account, and nothing is imported until
            you have seen what it is and said yes.
          </p>
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
            {active.length > 0 || filters.kind || filters.q?.trim()
              ? "Nothing on the hub matches those filters yet."
              : "The hub has nothing on it yet. Anything you share will show up here."}
          </EmptyState>
        )}
        {!loading && page && page.items.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
            {page.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {describeItem(item.kind, item.mode)}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(item.created_at)}
                  </span>
                </div>
                <p className="text-sm font-medium" title={item.title}>
                  {item.title}
                </p>
                {item.description && (
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {item.game_name && (
                    <FilterChip
                      label={item.game_name}
                      onClick={() => setFilter("game", item.game_name ?? "")}
                    />
                  )}
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
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto w-full"
                  onClick={() => importItem(item)}
                  disabled={importing !== null}
                  aria-label={`Import ${item.title}`}
                >
                  {importing === item.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {importing === item.id ? "Fetching…" : "Import"}
                </Button>
              </li>
            ))}
          </ul>
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
      className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {label}
    </button>
  );
}
