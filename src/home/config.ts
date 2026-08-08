/**
 * The `home` key of a distribution profile: which layout, what backdrop, and
 * which zones in what order.
 *
 * A distribution author writes this by hand in `profile.json`, with no schema
 * check between the keyboard and a shipped build. So the one rule this module
 * holds to is that a mistake never blanks the page. Every malformed value falls
 * back to the Coilbox default and says so on the console, because a distribution
 * shipping a broken home with no explanation is worse than one shipping the
 * stock home with a warning in it.
 *
 * `resolveHome` is pure: it takes the raw value and reads nothing else, so the
 * whole contract is unit-testable without a profile, a layout or a DOM.
 *
 * Every one of those console warnings is also returned, in {@link
 * ResolvedHome.issues}, so the profile health panel can show an author what was
 * dropped on a build with no devtools (issue #1080). One call site writes each
 * message, so the panel cannot describe a page the app did not draw.
 *
 * ## What this module does not decide
 *
 * Each entry is carried through verbatim in {@link HomeEntry.entry}, and a key
 * whose meaning belongs to another module is left raw for it rather than
 * half-checked here. `background` is `./background`'s, and the cards zone's
 * per-tool `art` map is `./profileArt`'s. Both fall back visibly on a bad value
 * the same way this module does.
 */

import {
  DEFAULT_LAYOUT,
  isLayoutName,
  LAYOUT_NAMES,
  type LayoutName,
} from "./layoutNames";

/** A profile's `home` key. Every field is optional, and an absent key is the default. */
export interface HomeConfig {
  /**
   * Layout name. Unset tracks the Coilbox default and moves when it does.
   * Naming one pins it, so a redesign that ships as a new layout leaves this
   * distribution on the screen it was built against.
   */
  layout?: string;
  /**
   * `@.coilbox/<path>` reference to a backdrop image, or `false` for none.
   * See `./background`, which owns what a value here resolves to.
   */
  background?: string | false;
  /**
   * The page, in order. Omitted tracks the Coilbox default. Present means this
   * list *is* the page: a zone left out is hidden, and zones Coilbox adds later
   * do not appear. That pin-versus-track trade is opted into by writing the key.
   */
  zones?: HomeZoneConfig[];
}

/** One entry in `home.zones`: a built-in zone, or a custom markup block. */
export interface HomeZoneConfig {
  /** A built-in zone id (see {@link DEFAULT_ZONES}). */
  zone?: string;
  /**
   * A custom entry's own markup, inline or an `@.coilbox/<path>` reference. An
   * entry naming a `zone` is a built-in zone and ignores this. See `./markup`.
   */
  html?: string;
  /** Markup at the head of the zone, same two forms as {@link html}. */
  before?: string;
  /** Markup at the foot of the zone, same two forms as {@link html}. */
  after?: string;
  /** Greeting only: the heading, replacing the greeting Coilbox would choose. */
  title?: string;
  /** Greeting only: the line under the heading. */
  tagline?: string;
  /**
   * Cards only: tool id to a file reference, or `false` for the icon-only card.
   * See `./profileArt`, which owns what a value here resolves to.
   */
  art?: Record<string, string | false>;
  /** Anything else an author wrote, kept verbatim for its own reader. */
  [key: string]: unknown;
}

/**
 * The zones the stacked layout renders, in the order it renders them. Also the
 * set of names a profile may use, so a zone that ships later joins this list and
 * appears for every distribution that did not pin `zones`.
 */
export const DEFAULT_ZONES = [
  "onboarding",
  "greeting",
  "continue",
  "resume",
  "cards",
  "suggested",
] as const;

/** A built-in zone id. */
export type ZoneId = (typeof DEFAULT_ZONES)[number];

/**
 * A Set, not an array scan or an object literal, so a profile naming
 * "constructor" or "toString" cannot resolve an inherited Object property as a
 * zone. Same reasoning as the layout registry.
 */
const KNOWN_ZONES: ReadonlySet<string> = new Set(DEFAULT_ZONES);

/** An entry as written by the author, untouched. */
export type RawEntry = Readonly<Record<string, unknown>>;

/** A per-entry option whose value is a string. */
export type ZoneStringKey = "before" | "after" | "title" | "tagline";

/** The markup keys every zone takes, in the order they render around it. */
const MARKUP_KEYS = ["before", "after"] as const;

/**
 * Which string options each zone reads, which is {@link HomeZoneConfig}'s
 * documentation made executable.
 *
 * The resolver reads them here rather than leaving them to the layout, so that
 * one walk over the entries decides everything the page acts on and there is
 * nothing left for a second reader to form its own opinion about (issue #1088).
 * A layout renders {@link HomeEntry.strings}, so what the profile health panel
 * lists is what the page was handed.
 *
 * The cost of that is this table: a zone that starts reading a new key has to be
 * added to it, or its author's mistakes stay silent. It lives beside the schema
 * that already promises which keys a zone takes, so the two are read together.
 */
const ZONE_STRING_KEYS: Readonly<Record<ZoneId, readonly ZoneStringKey[]>> = {
  onboarding: MARKUP_KEYS,
  // The only zone with options of its own: the heading and the line under it.
  greeting: [...MARKUP_KEYS, "title", "tagline"],
  continue: MARKUP_KEYS,
  resume: MARKUP_KEYS,
  cards: MARKUP_KEYS,
  suggested: MARKUP_KEYS,
};

/**
 * A zone's string options as resolved, with anything that was not a string
 * already dropped and reported. A key the author left out is absent, and an
 * empty string is kept, because a deliberate blank is not the same as no value.
 */
export type ZoneStrings = Readonly<Partial<Record<ZoneStringKey, string>>>;

/** No options, which is what an unconfigured zone has. */
const NO_STRINGS: ZoneStrings = Object.freeze({});

/** One resolved entry of the page. */
export type HomeEntry =
  /** A built-in zone the layout knows how to render. */
  | {
      readonly kind: "zone";
      readonly zone: ZoneId;
      readonly entry: RawEntry;
      /** The zone's string options, already checked. See {@link ZONE_STRING_KEYS}. */
      readonly strings: ZoneStrings;
    }
  /**
   * A distribution's own markup, sitting between zones. `html` is lifted out of
   * the entry because the schema has already checked it is a string, so the
   * layout does not repeat the check.
   */
  | { readonly kind: "html"; readonly html: string; readonly entry: RawEntry };

/** What the layout needs from the profile, all of it already validated. */
export interface ResolvedHome {
  /**
   * The pinned layout name, or undefined to track the Coilbox default. A name
   * this build does not ship reads as undefined, because that is the page drawn.
   */
  readonly layout?: LayoutName;
  /** The raw `background` value, for `resolveHomeBackground` to interpret. */
  readonly background: unknown;
  /** The page, in order. Never empty. */
  readonly entries: readonly HomeEntry[];
  /**
   * Whether these entries are the author's `zones` list. False means the page is
   * today's Coilbox default, either because no list was written or because
   * nothing in the one that was survived.
   */
  readonly pinned: boolean;
  /**
   * What the resolver dropped or ignored, in the order found, in the words it
   * put on the console. Empty for a page that resolved exactly as written.
   */
  readonly issues: readonly string[];
}

const NO_KEYS: RawEntry = Object.freeze({});

/**
 * A value as the author wrote it, short enough to read in a one-line warning.
 * Shared so every `home` complaint quotes a bad value the same way, whether it is
 * read off the console or out of the health panel.
 */
export function showHomeValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * Record one complaint about a profile's `home` key: on the console, where a dev
 * build shows it, and in `issues` when a caller is collecting them for the
 * profile health panel (issue #1080).
 *
 * Every `home` resolver writes its messages through here, so what the panel lists
 * is what the page acted on rather than a second opinion about it.
 */
export function noteHomeIssue(
  issues: string[] | undefined,
  message: string,
): void {
  console.warn(message);
  issues?.push(message);
}

/** An object that came out of JSON, excluding arrays and null. */
function asObject(value: unknown): RawEntry | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawEntry)
    : null;
}

/** The Coilbox page: every built-in zone, in the default order, unconfigured. */
function defaultEntries(): HomeEntry[] {
  return DEFAULT_ZONES.map((zone) => ({
    kind: "zone" as const,
    zone,
    entry: NO_KEYS,
    strings: NO_STRINGS,
  }));
}

/**
 * Resolve a profile's `home` key into the page to render.
 *
 * Never throws and never returns an empty page: the worst a bad value costs is a
 * console warning and the stock home.
 */
export function resolveHome(raw: unknown): ResolvedHome {
  const issues: string[] = [];
  const stock = () => ({
    background: undefined,
    entries: defaultEntries(),
    pinned: false,
    issues,
  });
  if (raw === undefined || raw === null) return stock();
  const home = asObject(raw);
  if (!home) {
    noteHomeIssue(
      issues,
      `home: ignoring \`home\`, expected an object, got ${showHomeValue(raw)}`,
    );
    return stock();
  }
  // Layout first, so a profile with several mistakes lists them in the order the
  // author wrote the keys rather than in the order this happens to check them.
  const layout = layoutName(home.layout, issues);
  const { entries, pinned } = resolveEntries(home.zones, issues);
  return {
    layout,
    // Left raw. `background.ts` owns what counts as a valid value, and it
    // already falls back to the default wash for anything it does not accept.
    background: home.background,
    entries,
    pinned,
    issues,
  };
}

/**
 * One line describing the page a profile asked for: which layout, how many zones,
 * and whether the list is pinned or tracking Coilbox's default.
 *
 * Written from the resolved page rather than from the raw key, so it counts the
 * zones that will be drawn. A dropped entry is missing from this count and named
 * in {@link ResolvedHome.issues}, which is the pairing the health panel shows.
 */
export function describeHome(home: ResolvedHome): string {
  const layout = home.layout ? `Layout "${home.layout}"` : "Default layout";
  const tracking = home.pinned ? "pinned" : "tracking the default";
  return `${layout}, ${home.entries.length} zone(s), ${tracking}`;
}

/**
 * The built-in zones this page carries.
 *
 * Derived from {@link ResolvedHome.entries} rather than stored beside them, so
 * the page has one list of zones and nothing to keep a second one in step with.
 *
 * The greeting reads it to decide which of its sentences are about anything the
 * player can see (issues #1079 and #1082). That is the page's composition, which
 * is the layout's to know and is settled before any zone renders. It is not
 * another zone's state: whether the grid drew a card, or whether there is a run
 * waiting, still belongs to the zone that draws it.
 */
export function zonesOnPage(
  entries: readonly HomeEntry[],
): ReadonlySet<ZoneId> {
  const zones = new Set<ZoneId>();
  for (const entry of entries) if (entry.kind === "zone") zones.add(entry.zone);
  return zones;
}

/**
 * The pinned layout name, or undefined to track the default.
 *
 * A name this build does not ship is dropped here rather than carried through to
 * `./layout`, which would fall back to the default anyway. Dropping it is what
 * lets {@link describeHome} say "Default layout" for a typo, which is the page
 * the author is looking at, instead of quoting a pin that did nothing (issue
 * #1088).
 *
 * The names come from `./layoutNames`, which holds no components, so asking the
 * question costs a leaf import rather than the whole home page.
 */
function layoutName(value: unknown, issues: string[]): LayoutName | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    noteHomeIssue(
      issues,
      `home: ignoring \`layout\`, expected a string, got ${showHomeValue(value)}`,
    );
    return undefined;
  }
  if (isLayoutName(value)) return value;
  noteHomeIssue(
    issues,
    `home: ignoring unknown layout ${showHomeValue(value)}, using "${DEFAULT_LAYOUT}". This build ships: ${LAYOUT_NAMES.join(", ")}`,
  );
  return undefined;
}

/**
 * Resolve `home.zones` into the entries to render.
 *
 * A bad entry is dropped and the rest of the list survives, so one typo costs
 * one zone rather than the page. If nothing survives, because the list was empty
 * or because every entry in it was bad, the default page comes back instead: a
 * home with nothing on it is indistinguishable from a crash. A distribution that
 * genuinely wants the page to itself has `welcome.html`, which replaces it
 * wholesale and is the sanctioned way to do that.
 *
 * `pinned` says which of the two happened: the author's list, or the default
 * that moves with Coilbox.
 */
function resolveEntries(
  zones: unknown,
  issues: string[],
): { entries: HomeEntry[]; pinned: boolean } {
  const stock = () => ({ entries: defaultEntries(), pinned: false });
  if (zones === undefined || zones === null) return stock();
  if (!Array.isArray(zones)) {
    noteHomeIssue(
      issues,
      `home: ignoring \`zones\`, expected an array, got ${showHomeValue(zones)}`,
    );
    return stock();
  }
  const seen = new Set<ZoneId>();
  const entries: HomeEntry[] = [];
  for (const raw of zones) {
    const entry = asObject(raw);
    if (!entry) {
      noteHomeIssue(
        issues,
        `home: ignoring a zone entry that is not an object: ${showHomeValue(raw)}`,
      );
      continue;
    }
    if (typeof entry.zone === "string") {
      if (!KNOWN_ZONES.has(entry.zone)) {
        // Quoted through the shared formatter, so a name long enough to fill the
        // health panel is cut to length like any other bad value.
        noteHomeIssue(
          issues,
          `home: ignoring unknown zone ${showHomeValue(entry.zone)}`,
        );
        continue;
      }
      const zone = entry.zone as ZoneId;
      if (seen.has(zone)) {
        // Two greetings or two tool grids reads as a bug to whoever sees the
        // page, and a repeated zone is nearly always a copy-paste slip. Keeping
        // the first leaves the author a page plus a warning naming the zone.
        noteHomeIssue(issues, `home: ignoring a repeated "${zone}" zone`);
        continue;
      }
      seen.add(zone);
      entries.push({
        kind: "zone",
        zone,
        entry,
        strings: zoneStrings(zone, entry, issues),
      });
      continue;
    }
    if (typeof entry.html === "string") {
      entries.push({ kind: "html", html: entry.html, entry });
      continue;
    }
    noteHomeIssue(
      issues,
      `home: ignoring a zone entry with no \`zone\` name or \`html\`: ${showHomeValue(raw)}`,
    );
  }
  if (entries.length === 0) {
    noteHomeIssue(
      issues,
      "home: `zones` left nothing to render, using the default page",
    );
    return stock();
  }
  return { entries, pinned: true };
}

/**
 * The string options a zone reads, checked once, here.
 *
 * A non-string is a distribution bug, so it is dropped with a complaint rather
 * than rendered into the heading, and the zone falls back to what Coilbox would
 * have said. Only the keys {@link ZONE_STRING_KEYS} lists for this zone are read,
 * so a `title` on the tool grid, which nothing renders, is not reported as a
 * value that was ignored: it was never going to be used, string or not.
 *
 * The complaint names the zone, because the health panel lists these lines with
 * nothing else around them.
 */
function zoneStrings(
  zone: ZoneId,
  entry: RawEntry,
  issues: string[],
): ZoneStrings {
  let strings: Partial<Record<ZoneStringKey, string>> | undefined;
  for (const key of ZONE_STRING_KEYS[zone]) {
    const value = entry[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      noteHomeIssue(
        issues,
        `home: ignoring \`${key}\` on the "${zone}" zone, expected a string, got ${showHomeValue(value)}`,
      );
      continue;
    }
    strings ??= {};
    strings[key] = value;
  }
  return strings ?? NO_STRINGS;
}
