import { Button } from "@picoframe/frame";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Loader2,
  RotateCw,
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
import type { ImportPlan } from "@/deeplink/actions";
import { fetchImportPlan } from "@/deeplink/fetchImport";
import { fetchImportText } from "@/deeplink/fetchText";
import { getGameMatcher, getProfile } from "@/profile/profile";
import { describeItem, fetchHubItem, type HubItemDetail } from "../api";
import { describePinnedGame, matchesPinnedGame } from "../browse";
import { useHubUrl } from "../config";
import { type HubItemPresence, withHubItem } from "../importRecord";
import { useHubItemPresence } from "../imports";

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
 * choosing this item. What the page cannot know is what the container itself
 * turns out to be, so that is the one thing kept. Coilbox fetches it through the
 * same capped Rust fetch and the same `identify()` gate the deep-link flow uses,
 * and goes straight to the importer when the answer matches this page. When it
 * does not, or the container warns about its version, the difference is shown
 * here and the button asks again. The importer is unchanged and still resolves
 * missing content before it saves anything.
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

/** A container that came back, once it has been checked against this page. */
interface Checked {
  plan: ImportPlan;
  /** Everything the page could not already say. Empty means go straight there. */
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
  const [checked, setChecked] = useState<Checked | null>(null);

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

  // Fetch the container, check what came back against what this page says, and
  // send it to its importer. Nothing is saved here: the importer resolves any
  // missing content and asks before it writes.
  const startImport = useCallback(async () => {
    if (!item) return;
    setFetching(true);
    setImportError(null);
    const result = await fetchImportPlan(item.container_url, fetchImportText);
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
    if (notes.length === 0) {
      navigate(withHubItem(result.plan.route, item.id));
      return;
    }
    setChecked({ plan: result.plan, notes });
  }, [item, navigate]);

  const presence: HubItemPresence = item ? presenceOf(item) : { state: "none" };

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
              <Badge variant="secondary">
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
          <div className="flex max-w-3xl flex-col gap-6">
            <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
              {item.description || (
                <span className="text-muted-foreground">
                  Whoever shared this wrote no description.
                </span>
              )}
            </p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <Meta label="Game">
                {item.game_name ?? (
                  <span className="text-muted-foreground">
                    Not tied to one game
                  </span>
                )}
                {offPin && (
                  <span className="mt-1 block max-w-prose text-xs text-muted-foreground">
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

            {importError && (
              <Alert variant="destructive">
                <AlertCircle size={15} />
                <AlertDescription className="text-destructive">
                  {importError}
                </AlertDescription>
              </Alert>
            )}
            {checked && (
              <Alert variant="warning">
                <TriangleAlert size={15} />
                <AlertDescription>
                  <ul className="flex flex-col gap-1">
                    {checked.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {presence.state === "here" && (
                  <Button onClick={() => navigate(presence.route)}>
                    <ArrowRight /> Open
                  </Button>
                )}
                <Button
                  variant={presence.state === "here" ? "outline" : "default"}
                  onClick={() =>
                    checked
                      ? navigate(withHubItem(checked.plan.route, item.id))
                      : void startImport()
                  }
                  disabled={fetching}
                >
                  {fetching ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {importLabel(fetching, checked !== null, presence.state)}
                </Button>
              </div>
              <p className="max-w-prose text-xs text-muted-foreground">
                {presence.state === "gone" &&
                  "You imported this before. Nothing of it is here now. "}
                Coilbox downloads it from {hostOf(hubUrl)} and opens it in the
                importer, which resolves any missing content before saving.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** What the import button says, which depends on how far the press has got. */
function importLabel(
  fetching: boolean,
  rechecking: boolean,
  state: HubItemPresence["state"],
): string {
  if (fetching) return "Fetching…";
  if (rechecking) return "Import anyway";
  return state === "here" ? "Import again" : "Import";
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
