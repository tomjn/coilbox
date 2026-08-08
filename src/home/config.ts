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
 * ## What this build does not use yet
 *
 * Each entry is carried through verbatim in {@link HomeEntry.entry}. Keys this
 * build has no use for are neither validated nor stripped, deliberately, so the
 * issues that add them are additions rather than rewrites:
 *
 * - The per-tool `art` map on the cards zone is issue #1000.
 */

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
  /** Cards only: tool id to a file reference, or `false` for icon only. Issue #1000. */
  art?: Record<string, string | false>;
  /** Anything else an author wrote, kept for the issues above. */
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

/** One resolved entry of the page. */
export type HomeEntry =
  /** A built-in zone the layout knows how to render. */
  | { readonly kind: "zone"; readonly zone: ZoneId; readonly entry: RawEntry }
  /**
   * A distribution's own markup, sitting between zones. `html` is lifted out of
   * the entry because the schema has already checked it is a string, so the
   * layout does not repeat the check.
   */
  | { readonly kind: "html"; readonly html: string; readonly entry: RawEntry };

/** What the layout needs from the profile, all of it already validated. */
export interface ResolvedHome {
  /** The pinned layout name, or undefined to track the Coilbox default. */
  readonly layout?: string;
  /** The raw `background` value, for `resolveHomeBackground` to interpret. */
  readonly background: unknown;
  /** The page, in order. Never empty. */
  readonly entries: readonly HomeEntry[];
}

const NO_KEYS: RawEntry = Object.freeze({});

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
  }));
}

/**
 * Resolve a profile's `home` key into the page to render.
 *
 * Never throws and never returns an empty page: the worst a bad value costs is a
 * console warning and the stock home.
 */
export function resolveHome(raw: unknown): ResolvedHome {
  if (raw === undefined || raw === null)
    return { background: undefined, entries: defaultEntries() };
  const home = asObject(raw);
  if (!home) {
    console.warn("home: ignoring `home`, expected an object, got", raw);
    return { background: undefined, entries: defaultEntries() };
  }
  return {
    layout: layoutName(home.layout),
    // Left raw. `background.ts` owns what counts as a valid value, and it
    // already falls back to the default wash for anything it does not accept.
    background: home.background,
    entries: resolveEntries(home.zones),
  };
}

/**
 * The pinned layout name, or undefined to track the default. Only the type is
 * checked here. Whether the name exists is the registry's question, because only
 * the registry knows what this build ships (see `./layout`).
 */
function layoutName(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  console.warn("home: ignoring `layout`, expected a string, got", value);
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
 */
function resolveEntries(zones: unknown): HomeEntry[] {
  if (zones === undefined || zones === null) return defaultEntries();
  if (!Array.isArray(zones)) {
    console.warn("home: ignoring `zones`, expected an array, got", zones);
    return defaultEntries();
  }
  const seen = new Set<ZoneId>();
  const entries: HomeEntry[] = [];
  for (const raw of zones) {
    const entry = asObject(raw);
    if (!entry) {
      console.warn("home: ignoring a zone entry that is not an object:", raw);
      continue;
    }
    if (typeof entry.zone === "string") {
      if (!KNOWN_ZONES.has(entry.zone)) {
        console.warn(`home: ignoring unknown zone "${entry.zone}"`);
        continue;
      }
      const zone = entry.zone as ZoneId;
      if (seen.has(zone)) {
        // Two greetings or two tool grids reads as a bug to whoever sees the
        // page, and a repeated zone is nearly always a copy-paste slip. Keeping
        // the first leaves the author a page plus a warning naming the zone.
        console.warn(`home: ignoring a repeated "${zone}" zone`);
        continue;
      }
      seen.add(zone);
      entries.push({ kind: "zone", zone, entry });
      continue;
    }
    if (typeof entry.html === "string") {
      entries.push({ kind: "html", html: entry.html, entry });
      continue;
    }
    console.warn(
      "home: ignoring a zone entry with no `zone` name or `html`:",
      raw,
    );
  }
  if (entries.length === 0) {
    console.warn(
      "home: `zones` left nothing to render, using the default page",
    );
    return defaultEntries();
  }
  return entries;
}

/**
 * A string option off a zone entry, or undefined when the author left it out.
 *
 * The reader of per-entry config this build has, used for the greeting's `title`
 * and `tagline` and for a zone's `before` and `after` markup. A non-string is a
 * distribution bug, so it warns and falls back to what Coilbox would have said
 * rather than rendering an object into the heading.
 */
export function zoneString(entry: RawEntry, key: string): string | undefined {
  const value = entry[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  console.warn(`home: ignoring \`${key}\`, expected a string, got`, value);
  return undefined;
}
