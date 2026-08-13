/**
 * Do you already have this hub item? The record and the reasoning, with no
 * store and no React in it (issue #1368). `./imports.ts` is the same answer
 * wired to the four places an import lands.
 *
 * A hub item is a container, and each kind lands somewhere different once
 * imported: a preset in the presets setting, a conquest challenge as a galaxy
 * document, a warpath challenge as a run, a scenario as a scenario document, a
 * setup pack as whatever presets it bundled plus the games and maps it named.
 * None of those carry a hub id, and an item's hub title is written by whoever
 * published it, so it does not match the name the artefact ends up with.
 * There is nothing to compare an item against.
 *
 * So this keeps a record, and never believes it on its own. The record says
 * which local ids one import produced. The answer to "do I have this" is
 * whether any of those ids is still there right now, which is
 * {@link presenceOf}. Delete the thing and the record stops meaning you have
 * it. Reinstall and every record goes with the rest of the app data, so nothing
 * is claimed that is not there.
 *
 * The hub item id reaches the importer without touching the `coilbox://`
 * grammar. The browse screen calls {@link noteHubContainer} with the address it
 * just read out of the hub's own API, the deep-link handler looks that address
 * up when it has finished fetching, and only then does the id ride the importer
 * route as `&hub=` ({@link withHubItem}). A link from anywhere else names an
 * address nothing has claimed, so it records nothing.
 */

/** What one import from the hub produced. */
export interface HubImportRecord {
  /** The hub item's id. */
  id: string;
  /** Local ids the import created, in whichever store its kind lands in. */
  refs: string[];
  /** Where to send someone who wants to open it. */
  route: string;
  /** When it was imported, ISO 8601. */
  at: string;
  /** The content this import asked to be installed, for a pack that bundled no
   * presets and so created no local ids. Names, not ids: a map and a game are
   * known by name in every store that holds them. */
  content?: { games: string[]; maps: string[] };
}

/** The settings key the records live under. */
export const HUB_IMPORTS_KEY = "hub.imports";

/** Most records to keep. Old ones are dropped rather than growing without end,
 * and losing the oldest only means an item reads as not imported again. */
export const MAX_RECORDS = 500;

/** Where an item stands with this install. */
export type HubItemPresence =
  /** Never imported. */
  | { state: "none" }
  /** Imported, and what it produced is still here. */
  | { state: "here"; route: string }
  /** Imported before, but nothing it produced is here now. */
  | { state: "gone" }
  /** The local stores have not answered yet. */
  | { state: "unknown" };

/** Add `&hub=<id>` to an importer route, so the importer can record what the
 * import produced. Left alone when there is no id. */
export function withHubItem(route: string, hubItemId?: string): string {
  if (!hubItemId) return route;
  const join = route.includes("?") ? "&" : "?";
  return `${route}${join}hub=${encodeURIComponent(hubItemId)}`;
}

/**
 * Container addresses the browse screen has read out of the hub API this
 * session, against the item each belongs to. Session-scoped on purpose: it is a
 * note of what this app just did, not a claim anybody else can make.
 */
const containerUrls = new Map<string, string>();

/** Most addresses to remember. Browsing for an hour should not grow without
 * end, and forgetting one only means that import is not recorded. */
const MAX_CONTAINER_URLS = 200;

/** Note that `url` is where hub item `id`'s container lives. */
export function noteHubContainer(url: string, id: string): void {
  containerUrls.delete(url);
  containerUrls.set(url, id);
  while (containerUrls.size > MAX_CONTAINER_URLS) {
    const oldest = containerUrls.keys().next().value;
    if (oldest === undefined) break;
    containerUrls.delete(oldest);
  }
}

/** Which hub item this container address belongs to, if this session read it
 * off the hub. Undefined for an address that arrived any other way. */
export function hubItemIdForContainer(url: string): string | undefined {
  return containerUrls.get(url);
}

/** What one hub item said about itself, for an importer that records where a
 * copy came from (issue #1473). Only what the item page shows anyway: the id
 * rides the importer route, and the rest would otherwise have to be fetched
 * again to say who published something you just pressed Import on. */
export interface NotedHubItem {
  id: string;
  title: string;
  author: string;
}

/**
 * Items this session has read off the hub, by id. Session-scoped for the same
 * reason the addresses above are: it is a note of what this app just did, and
 * a stale one only means an import records the item's id without its author.
 */
const hubItems = new Map<string, NotedHubItem>();

/** Note what the hub says about `item`, for an import about to be started
 * from it. */
export function noteHubItem(item: {
  id: string;
  title: string;
  author_name: string;
}): void {
  hubItems.delete(item.id);
  hubItems.set(item.id, {
    id: item.id,
    title: item.title,
    author: item.author_name,
  });
  while (hubItems.size > MAX_CONTAINER_URLS) {
    const oldest = hubItems.keys().next().value;
    if (oldest === undefined) break;
    hubItems.delete(oldest);
  }
}

/** What this session read about a hub item, if it read it. */
export function notedHubItem(id: string): NotedHubItem | undefined {
  return hubItems.get(id);
}

/** Forget every noted address and item. For tests. */
export function clearNotedHubContainers(): void {
  containerUrls.clear();
  hubItems.clear();
}

/** Fold a fresh record into the list, replacing any earlier one for the same
 * item and trimming the oldest away. */
export function withRecord(
  records: HubImportRecord[],
  record: HubImportRecord,
): HubImportRecord[] {
  return [record, ...records.filter((r) => r.id !== record.id)].slice(
    0,
    MAX_RECORDS,
  );
}

/**
 * Work out where an item stands from its record and the local ids of its kind.
 * `local` is null when the ids are not known yet.
 *
 * `routeFor` addresses whichever id survived, for the kinds that can be
 * addressed one at a time (issue #1372). It beats the recorded route because
 * the record is written once and the ids outlive it: a setup pack that brought
 * three presets and lost the first still has two, and a record written before
 * those addresses existed names only the list screen. Without it, the recorded
 * route stands, which is what a conquest or warpath challenge wants since its
 * route already names the galaxy or the run.
 *
 * `contentRoute` is where to send Open when none of the recorded ids survived
 * but the content case below still says the item is here. The recorded route
 * can name a preset from that same import, and a pack that bundled both
 * presets and content still reads as here once its presets are gone as long
 * as the content is, so that route would address something deleted.
 */
export function presenceOf(
  record: HubImportRecord | undefined,
  local: ReadonlySet<string> | null,
  routeFor?: (ref: string) => string,
  installed?: { games: ReadonlySet<string>; maps: ReadonlySet<string> } | null,
  contentRoute?: string,
): HubItemPresence {
  if (!record) return { state: "none" };
  if (!local) return { state: "unknown" };
  const alive = record.refs.find((ref) => local.has(ref));
  if (alive !== undefined) {
    return { state: "here", route: routeFor ? routeFor(alive) : record.route };
  }
  // A pack that bundled no presets left no ids behind, so what it asked for is
  // the only evidence it is still here. All of it, because a collection half
  // installed is not the collection somebody shared.
  if (record.content) {
    if (installed === null) return { state: "unknown" };
    if (installed) {
      const hasAll =
        record.content.games.every((g) => installed.games.has(g)) &&
        record.content.maps.every((m) => installed.maps.has(m));
      if (hasAll) {
        return { state: "here", route: contentRoute ?? record.route };
      }
    }
  }
  return { state: "gone" };
}
