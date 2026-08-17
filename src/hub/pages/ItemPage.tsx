import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  Link2 as LinkIcon,
  Loader2,
  RotateCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { asContainer, decodeContainerText } from "@/container/container";
import { useScanTargetSelection, useUnitsyncMinimap } from "@/content/config";
import type { ImportPlan } from "@/deeplink/actions";
import { ConfirmDialog, type Pending } from "@/deeplink/ConfirmDialog";
import { fetchImportPlan } from "@/deeplink/fetchImport";
import { fetchImportText } from "@/deeplink/fetchText";
import { getGameMatcher, getProfile } from "@/profile/profile";
import { describeItem, fetchHubItem, type HubItemDetail } from "../api";
import { MapPictureCard } from "../assets/MapPicture";
import { useMapPictureLadder } from "../assets/useMapPicture";
import { describePinnedGame, matchesPinnedGame } from "../browse";
import { KindIcon } from "../components/KindIcon";
import { useHubUrl } from "../config";
import {
  type HubItemPresence,
  noteHubItem,
  withHubItem,
} from "../importRecord";
import { useHubItemPresence } from "../imports";
import { type HubPreview, readPreview } from "../preview";
import { hubItemPageUrl } from "../publish";
import { type HubRemoval, useHubRemoval } from "../remove";
import { ItemPreview } from "./components/ItemPreview";

/**
 * One item on the Coilbox hub, in full (issue #1366). The browse screen has room
 * for three lines of a description and a row of chips. This has room for the
 * whole thing, which is what somebody deciding whether they want it needs.
 *
 * It is also where a hub link lands. The website's Import button emits
 * `coilbox://import?url=<hub>/i/<id>`, and the deep-link handler sends that here
 * instead of into the generic fetch flow (see `DeepLinkHandler.tsx`), so every
 * link already shared in a channel arrives on a page about the thing rather than
 * in a dialog about a download.
 *
 * Pressing Import here does not then ask the same question in a dialog. The
 * confirmation it replaces said which host the content came from and what kind
 * of thing it was. Both are on this page already, and the reader got here by
 * choosing this item.
 *
 * What the page cannot know from the hub's API is what is actually in the
 * container, because the API hands out a pointer to it and never the thing
 * itself. So the page fetches it on arrival, through the same capped Rust fetch
 * and the same `identify()` gate the deep-link flow uses, and draws what it
 * finds (`../preview.ts`). Nothing is saved by that: it is a read of a file the
 * page was going to read anyway when Import was pressed, brought forward so the
 * reader can see the thing before deciding.
 *
 * That also moves the checks earlier. A container whose kind disagrees with what
 * the hub lists, or which warns about its version, says so on the page rather
 * than after a press, and Import then says "anyway". Import itself hands the
 * already-fetched container to the importer, which is unchanged and still
 * resolves missing content before it saves anything.
 *
 * A link can address an item a distribution's game pin keeps off the browse list
 * (issue #1362). The page shows it and still imports it, and says which game it
 * is for. The pin scopes what coilbox advertises, the way it does everywhere
 * else, and it is not a permission check: somebody was handed this link on
 * purpose, and a page that refused to say what they were given would be a dead
 * end rather than a narrower gallery.
 */

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { dateStyle: "long" });
}

/** The hub's host, for saying where an import comes from. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The container this item points at, once it has arrived and been checked
 * against what the page says. */
interface Fetched {
  plan: ImportPlan;
  /** What it looks like, or null when its payload had nothing to draw. */
  preview: HubPreview | null;
  /** Everything the page could not already say. Empty means Import can go
   * straight to the importer. */
  notes: string[];
}

export default function ItemPage() {
  const { id: rawId } = useParams();
  const id = rawId ? decodeURIComponent(rawId) : "";
  const hubUrl = useHubUrl();
  const navigate = useNavigate();
  const presenceOf = useHubItemPresence();

  const [item, setItem] = useState<HubItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fetching, setFetching] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  // Ask the hub for this item. Returns the abort, so the effect below can drop
  // an answer to a question the page has stopped asking, and Try again can call
  // the same thing without one.
  const load = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchHubItem(hubUrl, id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.ok) {
        setItem(result.value);
      } else {
        setItem(null);
        setError(result.reason);
      }
    });
    return () => controller.abort();
  }, [hubUrl, id]);

  useEffect(() => load(), [load]);

  // Fetch the container and check what came back against what this page says.
  // Nothing is saved here and nothing is imported: this is the same capped
  // fetch and the same `identify()` gate Import runs, moved to page load so the
  // page can show what the thing looks like and flag any discrepancy before the
  // button is pressed rather than after.
  const loadContainer = useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!item) return;
      setFetching(true);
      setImportError(null);
      const result = await fetchImportPlan(item.container_url, fetchImportText);
      // The fetch has no abort, so a container for an item the reader has since
      // navigated away from is dropped here rather than landing on the page
      // they are now looking at.
      if (signal?.cancelled) return;
      setFetching(false);
      if (!result.ok) {
        setImportError(result.reason);
        return;
      }
      const notes = [...result.plan.warnings];
      if (result.plan.kind !== item.kind) {
        const listed = describeItem(item.kind, item.mode).toLowerCase();
        notes.push(
          `The hub lists this as a ${listed}, but what it sent is a ${result.plan.label}.`,
        );
      }
      const container = asContainer(decodeContainerText(result.text));
      setFetched({
        plan: result.plan,
        preview: container ? readPreview(container) : null,
        notes,
      });
    },
    [item],
  );

  // One fetch per item. A failure leaves the reason showing and no container,
  // which is the state Import retries from.
  useEffect(() => {
    const signal = { cancelled: false };
    setFetched(null);
    void loadContainer(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadContainer]);

  const presence: HubItemPresence = item ? presenceOf(item) : { state: "none" };

  // What Remove would delete, or null when there is nothing of this item here.
  const removalOf = useHubRemoval();
  const removal = item ? removalOf(item) : null;

  // The address to hand somebody else. The website's own page for the item
  // rather than the container underneath it: a person following a link wants
  // something to read, and coilbox recognises both (see `hubItemIdFromUrl`), so
  // a copy of this pasted back into coilbox lands on this same page.
  const pageUrl = hubItemPageUrl(hubUrl, id);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A clipboard the webview will not write to is not worth an error banner.
      // "View on the hub" opens the same address either way.
    }
  };

  // Is this item one the distribution's game pin keeps off the browse list? Read
  // once: the profile is loaded at startup and never changes.
  const pinnedMatcher = useMemo(() => getGameMatcher(), []);
  const pinnedGame = useMemo(
    () => describePinnedGame(getProfile().gameFilter),
    [],
  );
  const offPin =
    item !== null && !matchesPinnedGame(item.game_name, pinnedMatcher);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b border-border px-6 py-4">
        <Link
          to="/hub"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Coilbox hub
        </Link>
        {item && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <KindIcon kind={item.kind} mode={item.mode} />
                {describeItem(item.kind, item.mode)}
              </Badge>
              {presence.state === "here" && (
                <Badge variant="outline" className="gap-1">
                  <Check className="size-3" aria-hidden /> Imported
                </Badge>
              )}
            </div>
            <h1 className="text-lg font-semibold leading-tight">
              {item.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              Shared by {item.author_name}
              {item.created_at ? ` on ${formatDate(item.created_at)}` : ""}
            </p>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> loading the hub…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle size={15} />
            <AlertDescription className="flex flex-wrap items-center gap-3 text-destructive">
              {error}
              <Button variant="outline" size="sm" onClick={() => load()}>
                <RotateCw className="mr-1.5 size-3.5" aria-hidden /> Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {item && (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-6">
              <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
                {item.description || (
                  <span className="text-muted-foreground">
                    Whoever shared this wrote no description.
                  </span>
                )}
              </p>

              {fetching && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={15} className="animate-spin" /> reading what is
                  in it…
                </p>
              )}
              {fetched?.preview && <ItemPreview preview={fetched.preview} />}

              {fetched && fetched.notes.length > 0 && (
                <Alert variant="warning">
                  <TriangleAlert size={15} />
                  <AlertDescription>
                    <ul className="flex flex-col gap-1">
                      {fetched.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {importError && (
                <Alert variant="destructive">
                  <AlertCircle size={15} />
                  <AlertDescription className="flex flex-wrap items-center gap-3 text-destructive">
                    {importError}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadContainer()}
                      disabled={fetching}
                    >
                      <RotateCw className="mr-1.5 size-3.5" aria-hidden /> Try
                      again
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex flex-col gap-6">
              {/* A pack draws its own maps under a heading, one or twenty
                  (issue #1721), and the row holds one name at most, so the slot
                  would show the first of them and no more. */}
              {item.map_name && item.kind !== "setup-pack" && (
                <ItemMapPicture mapName={item.map_name} />
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <Meta label="Game">
                  {item.game_name ?? (
                    <span className="text-muted-foreground">
                      Not tied to one game
                    </span>
                  )}
                  {offPin && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      This copy of Coilbox is set up for{" "}
                      {pinnedGame ?? "another game"}, so this is not in its hub
                      list. You can still import it.
                    </span>
                  )}
                </Meta>
                <Meta label="Map">
                  {item.map_name ?? (
                    <span className="text-muted-foreground">
                      Not tied to one map
                    </span>
                  )}
                </Meta>
                {item.tags.length > 0 && (
                  <Meta label="Tags">
                    <span className="flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          #{tag}
                        </Badge>
                      ))}
                    </span>
                  </Meta>
                )}
              </dl>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {presence.state === "here" ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => navigate(presence.route)}
                      >
                        <ArrowRight /> Open
                      </Button>
                      {removal && (
                        <Button
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPending(confirmRemoval(removal))}
                        >
                          <Trash2 /> Remove
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!fetched) {
                          void loadContainer();
                          return;
                        }
                        // What the hub says about it, so an importer that
                        // records where a copy came from can name the author
                        // rather than an id (issue #1473).
                        noteHubItem(item);
                        navigate(withHubItem(fetched.plan.route, item.id));
                      }}
                      disabled={fetching}
                    >
                      {fetching ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Download />
                      )}
                      {importLabel(fetching, fetched?.notes.length ?? 0)}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {presence.state === "gone" &&
                    "You imported this before. Nothing of it is here now. "}
                  Coilbox downloads it from {hostOf(hubUrl)} and opens it in the
                  importer, which resolves any missing content before saving.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={copyLink}>
                    {copied ? <Check /> : <LinkIcon />}
                    {copied ? "Link copied" : "Copy link"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openUrl(pageUrl)}
                  >
                    <ExternalLink /> View on the hub
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog pending={pending} setPending={setPending} />
    </div>
  );
}

/**
 * The question Remove asks before it deletes anything.
 *
 * It says the thing that is easy to get wrong, which is what "remove" means
 * here: the copy on this computer is deleted, and the hub's copy is not, so
 * this is undoable by importing it again. Anything the removal found using it
 * goes in as a warning.
 */
function confirmRemoval(removal: HubRemoval): Pending {
  return {
    title: removal.summary,
    lines: [
      "Coilbox deletes it from this computer. It stays on the hub, so you can import it again.",
    ],
    warnings: removal.warning ? [removal.warning] : [],
    confirmLabel: "Delete",
    run: () => void removal.run(),
    icon: Trash2,
  };
}

/** What the import button says. "Import anyway" when the page is already showing
 * something about the container that the reader should have seen first. */
function importLabel(fetching: boolean, notes: number): string {
  if (fetching) return "Fetching…";
  return notes > 0 ? "Import anyway" : "Import";
}

/**
 * The map an item is played on (issue #1637).
 *
 * The hub lists things for maps the reader may not own, and until now this page
 * had the map's name and nothing else, because coilbox draws minimaps out of
 * local archives and a map that is not installed has no archive to draw from.
 * The ladder in `../assets/picture.ts` fills that in, and always answers.
 *
 * The local rung comes from the same scan target the Maps screen reads, which is
 * the engine and data directory this session is set up for. Without one there is
 * no local picture and the ladder starts at the hub.
 */
function ItemMapPicture({ mapName }: { mapName: string }) {
  const { selected } = useScanTargetSelection();
  const minimap = useUnitsyncMinimap(
    selected?.enginePath,
    selected?.rootPath,
    mapName,
  );
  const ladder = useMapPictureLadder(mapName, minimap.url);

  return (
    <MapPictureCard mapName={mapName} ladder={ladder} className="w-full" />
  );
}

/** One labelled fact about the item. */
function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
