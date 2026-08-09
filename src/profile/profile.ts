import type { Accent, ThemeMode } from "@picoframe/frame";
import { defineCommand } from "@picoframe/plugin-sdk";
import type { ConquestNames } from "../conquest/names";
import type { MapExclusion, SuggestedMapList } from "../content/branding";
import type { HomeConfig } from "../home/config";
import type { GameAiConfig } from "../play/gameAi";
import { describeJsonError } from "./jsonError";
import { type OnboardingPlacement, onboardingPlacement } from "./onboarding";
import { readProfileFile, resolveFileRef } from "./refs";

/**
 * Distribution profile: a `profile.json` a bundler drops into the portable
 * `.coilbox/` folder to reskin/narrow Coilbox at runtime — without forking or a
 * separate build. Read once at startup by the Rust `coilbox-profile` plugin (which
 * stays schema-agnostic); this module owns the schema and applies it.
 *
 * An absent file (or a non-portable install) yields an empty `{ version: 1 }`
 * profile, so vanilla Coilbox behaves exactly as before.
 */

/** Match a game by case-insensitive regex and/or exact names (mirrors branding). */
export interface GameFilter {
  regex?: string;
  names?: string[];
}

/** Declarative branded welcome screen. Trusted, bundler-authored; no JS by design. */
export interface WelcomeConfig {
  /**
   * Raw HTML rendered into the welcome page body. Either an inline fragment, or a
   * `@.coilbox/<path>.html` reference resolved to the file's contents at startup
   * (issue #274) — the file's raw HTML is the sole sanctioned exception to the
   * otherwise script-free, markdown-safe content model.
   */
  html?: string;
  /**
   * CSS injected alongside the welcome HTML. Inline, or a `@.coilbox/<path>.css`
   * file reference (resolved like {@link WelcomeConfig.html}).
   */
  css?: string;
}

/** An external link a profile adds to the sidebar (and home launcher). */
export interface LinkConfig {
  /** Sidebar label, e.g. "Discord". */
  label: string;
  /** External URL, opened in the system browser. Must be http(s)/mailto/tel. */
  href: string;
  /** Curated lucide icon name (see docs); unknown or omitted → ExternalLink. */
  icon?: string;
  /** Display label of the sidebar group; omitted → the default "Links" group. */
  group?: string;
}

/** Startup brand splash: a centered image over a solid backdrop, fade in/out. */
export interface SplashConfig {
  /**
   * Image to show centered. Either a path relative to the portable `.coilbox/`
   * folder (read by the Rust plugin into a data URI so it works offline), or an
   * inline `data:` / `http(s):` URL used verbatim.
   */
  image: string;
  /**
   * Solid backdrop CSS colour. Defaults to the profile's {@link Profile.background}
   * (if set), else the theme background token.
   */
  background?: string;
  /** Total duration in ms (fade in + hold + fade out). Defaults to 3000. */
  duration?: number;
}

/** Text and/or logo image for a top-bar slot; `href` makes it a link. */
export interface ProfileLogo {
  /** Text shown when no image resolves. */
  text?: string;
  /**
   * `.coilbox`-relative path (or inline `data:`/`http(s):`) to a logo image,
   * resolved to a data URI. Wins over `text` when it resolves.
   */
  image?: string;
  /**
   * URL opened in the system browser (http(s)/mailto/tel). When set and valid,
   * the logo/text becomes a clickable link.
   */
  href?: string;
}

/**
 * App-frame chrome the profile controls (picoframe `LayoutConfig` knobs + top-bar
 * slots, exposed as JSON). Mostly locks (authoritative, not user-overridable);
 * `sidebarCollapsed` is a seed. Menu branding only shows in popover mode.
 */
export interface ProfileLayout {
  /** Hide the breadcrumb region entirely. */
  hideBreadcrumb?: boolean;
  /** Lock the top-bar back/forward buttons on (true) or off (false). */
  historyButtons?: boolean;
  /**
   * Force the sidebar into popover mode (true) or a persistent rail (false).
   * A lock — no user toggle. Omitted → persistent sidebar (the vanilla default).
   */
  popover?: boolean;
  /**
   * Start with the sidebar collapsed. A seed, not a lock: applies only until the
   * user expands/collapses it, after which their choice persists. Only meaningful
   * when the sidebar is a persistent rail (popover off).
   */
  sidebarCollapsed?: boolean;
  /**
   * Show the top-bar fullscreen button (default true). When false the button is
   * hidden and F11 is inert (but fullscreen is not forced — see `fullscreenLocked`).
   */
  fullscreenButton?: boolean;
  /** Popover menu-button branding. */
  menu?: {
    /** Accessible name + tooltip for the menu button. */
    label?: string;
    /**
     * Show the label/logo beside the icon. Defaulted to true when `label` or
     * `image` is set (the frame only renders either while this is true); set
     * false explicitly for an icon-only button with a custom tooltip.
     */
    labelVisible?: boolean;
    /** Curated lucide icon name (see docs) for the closed state. */
    icon?: string;
    /** Curated lucide icon name for the open state. */
    iconOpen?: string;
    /**
     * `.coilbox`-relative path (or inline `data:`/`http(s):`) to a logo image,
     * resolved to a data URI and shown in place of the label text. Wins over
     * `label` as the visible content; `label` stays the accessible name.
     */
    image?: string;
  };
  /** Logo/text in the left top-bar slot. */
  left?: ProfileLogo;
  /** Logo/text centered in the top bar. */
  center?: ProfileLogo;
  /** Logo/text in the right top-bar slot. */
  right?: ProfileLogo;
}

/** A lobby server the profile defines inline (no id — the app assigns a stable one). */
export interface ProfileLobbyServer {
  /** Display name; defaults to the host when omitted. */
  name?: string;
  /** Hostname, e.g. "lobby.example.org". Required. */
  host: string;
  /** TCP port. Defaults to 8200 (the TASServer convention). */
  port?: number;
  /** Connect over TLS. Defaults to false. */
  tls?: boolean;
  /** Accept a self-signed server cert (uberserver ships one). Defaults to false. */
  allowSelfSigned?: boolean;
}

/** A channel the profile auto-joins on first connect to the official server. */
export interface ProfileChannel {
  name: string;
  /** Optional channel key/password sent with `JOIN <chan> <key>`. */
  key?: string;
}

/**
 * Lobby-server presets a distribution controls. Lets a bundler ship a single
 * "official" server (badged, non-removable, listed first), narrow which stock
 * presets appear, and seed the channels a player joins on login — without stopping
 * the player adding their own servers or removing their own logins.
 */
export interface ProfileLobby {
  /**
   * The preferred/"official" server: either a built-in id (e.g. "recoil-official")
   * to promote an existing preset, or an inline {@link ProfileLobbyServer}. Shown
   * with an "Official" badge, sorted first, and not removable (like the built-ins).
   */
  official?: string | ProfileLobbyServer;
  /**
   * Allow-list of built-in server ids to keep in the catalog. Omitted → all
   * built-ins are shown (vanilla behaviour). Present → only these appear (plus the
   * `official` server); `[]` hides every stock preset, leaving just the official one.
   * Never restricts the player's own custom servers.
   */
  presets?: string[];
  /**
   * Channels seeded into the auto-join list the first time a login connects to the
   * official server. A seed, not a lock: the player can leave them afterwards and
   * they stay gone (matching the per-user "remembered channels" list).
   */
  channels?: (string | ProfileChannel)[];
}

export interface Profile {
  version: number;
  /** Window + in-app title, e.g. "Splinter Faction - Coilbox". */
  title?: string;
  /** App-frame chrome (breadcrumb/history/popover/fullscreen/menu/logos). */
  layout?: ProfileLayout;
  /** Nav item ids to hide from the sidebar/launcher, e.g. ["downloads.games"]. */
  hide?: string[];
  /** Settings section ids to hide from the settings nav, e.g. ["uberstress"]. */
  hideSettings?: string[];
  /** Preset filter narrowing battle/game lists to one game. */
  gameFilter?: GameFilter;
  /**
   * Faction emblems, keyed by side name (case-insensitive, e.g. `arm`, `Armada`).
   * Each value is a `.coilbox`-relative path, `data:` URI, or `http(s)` URL. A hard
   * override: a distributor's faction art here wins over the game's own sidepics
   * and the branding catalog, so a white-label build fully controls faction art.
   */
  factionLogos?: Record<string, string>;
  /** Branded landing page shown in place of the default launcher. */
  welcome?: WelcomeConfig;
  /**
   * Coilbox's own home page: which layout, what backdrop, and which zones in
   * what order (see `../home/config`). Omitted gives the stock home, so every
   * profile written before this key existed is unaffected. Ignored when
   * {@link Profile.welcome} is set, because that replaces the page wholesale.
   */
  home?: HomeConfig;
  /**
   * Where the first-run onboarding (the "Set up Coilbox" + get-started download
   * suggestion cards) sits on the branded home. The {@link welcome} is always
   * rendered and never replaced by the onboarding — this only positions the cards
   * relative to it:
   * - `"below"` (default): under the welcome.
   * - `"above"`: over the welcome.
   * - `"off"`: hidden entirely, leaving the welcome as the whole home.
   *
   * `"off"` also hides the cards on a build with no `welcome`, where they sit at the
   * top of Coilbox's own home page. `"above"` and `"below"` have nothing to position
   * against there, so both leave them where they are. An omitted/unknown value is
   * treated as `"below"`.
   */
  onboarding?: OnboardingPlacement;
  /** External links added to the sidebar/launcher, e.g. a Discord invite. */
  links?: LinkConfig[];
  /** Lobby-server presets: an official server, a preset allow-list, seed channels. */
  lobby?: ProfileLobby;
  /** Brand splash shown over the whole window at startup. */
  splash?: SplashConfig;
  /**
   * Solid CSS colour painted behind everything from the first frame until the app
   * has rendered — kills the white flash a dark distribution otherwise shows while
   * it loads. Cached to localStorage so subsequent launches apply it before first
   * paint (see `main.tsx` and the boot script in `index.html`). Also the splash's
   * default backdrop, so one colour covers boot + splash.
   */
  background?: string;
  /** picoframe CSS variable overrides, e.g. { "--primary": "24 90% 50%" }. */
  theme?: Record<string, string>;
  /** Force a built-in accent (zinc/blue/green/rose/violet/orange) each launch. */
  accent?: Accent;
  /** Force the colour scheme each launch: "light" | "dark" | "system". */
  mode?: ThemeMode;
  /**
   * Seed the initial fullscreen state. A default, not a force: it applies only
   * until the user toggles fullscreen (F11 / top-bar button / setting), after
   * which their persisted choice wins on every subsequent launch.
   */
  fullscreen?: boolean;
  /**
   * Kiosk lock: force fullscreen every launch and remove the ways out — the
   * top-bar button and General-settings toggle are hidden and F11 is inert.
   * Overrides both {@link fullscreen} and any stored user choice while set.
   */
  fullscreenLocked?: boolean;
  /**
   * Show a Quit button in the sidebar footer. An intentional escape hatch for
   * fullscreen/kiosk builds where a player may have no other obvious way out, so
   * it is deliberately not suppressed by {@link fullscreenLocked}. Independent of
   * the `data-coilbox-action="quit"` welcome-HTML marker (see `BrandedWelcome`).
   */
  quit?: boolean;
  /**
   * Seed the initial "Advanced mode" state (developer/modding tools). Same
   * default-not-force semantics as {@link fullscreen}: a user's General-settings
   * toggle persists over the profile seed.
   */
  advanced?: boolean;
  /**
   * Whether the profile authoring tools appear in the Distribution profile settings
   * section: "Reload profile" (re-reads this file and re-applies it without an app
   * restart) and, when no profile is loaded yet, "Create profile.json". Defaults to
   * true, so authoring a profile needs no opt-in. Set false in a shipped build so a
   * player can't reload or replace the distribution's branding by accident. A lock,
   * not a seed, for the same reason as {@link Profile.updater}.
   */
  authoring?: boolean;
  /**
   * Whether Coilbox checks for new releases of itself. Defaults to true. Set false
   * in a build whose Coilbox binary the distributor ships and updates themselves:
   * no launch check runs, so no "Update available" pill or toast appears, and the
   * Updates settings section drops its check/install controls. Independent of
   * {@link Profile.release}, so the game archive a distribution delivers keeps
   * updating either way.
   */
  updater?: boolean;
  /**
   * Whether the community hub is offered. Defaults to true. Set false in a
   * profile for a modded game whose distributor doesn't want a button pointing
   * players at a public gallery of other people's content.
   */
  hub?: boolean;
  /** GitHub repo ("owner/name") whose latest release ships this game's archive. */
  release?: { repo: string };
  /**
   * Curated map packs offered for bulk download on the maps download page.
   * Same shape as the branding catalog's; a distribution can ship its own
   * (e.g. a tournament map set) alongside — or instead of — the catalog's.
   */
  mapLists?: SuggestedMapList[];
  /**
   * Extra maps kept out of warpath and galactic conquest, on top of the branding
   * catalog's own list. Additive only: a distribution can exclude more maps than
   * the catalog does, never fewer. Same shape as the catalog's `excludedMaps`.
   */
  excludedMaps?: MapExclusion[];
  /**
   * Galactic-conquest naming: star/faction name pools and lore faction presets
   * for generated galaxies. Overrides the branding catalog's per-game defaults
   * (see `../conquest/names`).
   */
  conquest?: ConquestNames;
  /**
   * This game's AI catalogue: which AIs are hardest, which is standard, which
   * must never play, which are mini-games, and which garrison a neutral
   * conquest world. Overrides the branding catalog's per-game entry field by
   * field (see `../play/gameAi`).
   */
  ai?: GameAiConfig;
}

/** Where the profile came from. "seed" is reserved for a future bundled default. */
export type ProfileSource = "file" | "seed" | "default";

interface ProfileResult {
  json: string;
  source: string;
  /** Portable root (`<app_dir>/.coilbox`), or "" when not portable. */
  root: string;
}

const profileLoadCmd = defineCommand<Record<string, never>, ProfileResult>(
  "coilbox-profile",
  "profile_load",
);

const profileAssetCmd = defineCommand<{ path: string }, { dataUri: string }>(
  "coilbox-profile",
  "profile_asset",
);

/**
 * Resolve a {@link SplashConfig}'s `image` to a value usable as an `<img src>`.
 * A `data:`/`http(s):` string is used verbatim; anything else is treated as a
 * `.coilbox/`-relative path and read by the Rust plugin into a data URI. Returns
 * `null` when there's no splash or the file couldn't be read, so callers skip it.
 * Awaited during startup (before first paint) so the image is ready immediately.
 */
export async function resolveSplashSrc(): Promise<string | null> {
  const splash = loaded.splash;
  if (!splash?.image) return null;
  if (/^(data:|https?:)/i.test(splash.image)) return splash.image;
  try {
    const { dataUri } = await profileAssetCmd({ path: splash.image });
    return dataUri || null;
  } catch (e) {
    console.warn("profile: splash asset load failed", e);
    return null;
  }
}

/**
 * Resolve a profile image reference to an `<img src>` value. A `data:`/`http(s):`
 * string is used verbatim; anything else is treated as a `.coilbox`-relative path
 * and read by the Rust plugin into a data URI (same transport as {@link resolveSplashSrc}).
 * Returns `null` for an absent path or a failed read, so callers omit the image.
 */
export async function resolveProfileImage(
  path: string | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (/^(data:|https?:)/i.test(path)) return path;
  try {
    const { dataUri } = await profileAssetCmd({ path });
    return dataUri || null;
  } catch (e) {
    console.warn("profile: image asset load failed", e);
    return null;
  }
}

/** The welcome's html/css after `@.coilbox/...` file references are resolved to text. */
export interface ResolvedWelcome {
  html?: string;
  css?: string;
  /** A visible message when a referenced file couldn't be read (fail-loud). */
  error?: string;
}

// Populated by resolveWelcome() at startup (main.tsx awaits it before render) so
// BrandedWelcome can read the resolved html/css synchronously. Null when the profile
// has no welcome.
let resolvedWelcome: ResolvedWelcome | null = null;

/**
 * Resolve the welcome's `html`/`css`, following any `@.coilbox/<path>` file references
 * to the referenced file's contents (issue #274). Inline fragments pass through
 * unchanged, so existing profiles are untouched. A bad reference surfaces a visible
 * `error` rather than silently blanking the welcome. Idempotent; a no-op (leaves the
 * resolved welcome null) when the profile ships no welcome.
 */
export async function resolveWelcome(): Promise<void> {
  const w = loaded.welcome;
  if (!w) {
    resolvedWelcome = null;
    return;
  }
  const html = w.html
    ? await resolveFileRef(w.html, readProfileFile)
    : undefined;
  const css = w.css ? await resolveFileRef(w.css, readProfileFile) : undefined;
  resolvedWelcome = {
    html: html?.text,
    css: css?.text,
    error: html?.error ?? css?.error,
  };
}

/** The welcome after file-reference resolution (null until resolveWelcome() runs). */
export function getResolvedWelcome(): ResolvedWelcome | null {
  return resolvedWelcome;
}

const EMPTY_PROFILE: Profile = { version: 1 };

// Module singletons: populated by loadProfile() before first render (main.tsx
// awaits it), so getProfile()/getProfileSource() can be read synchronously
// anywhere afterwards — the same pattern the settings cache uses.
let loaded: Profile = EMPTY_PROFILE;
let loadedSource: ProfileSource = "default";
let loadedRoot = "";
let loadedError: string | null = null;
/** A monospace source excerpt pinpointing a parse error, when one was locatable. */
let loadedErrorSnippet: string | null = null;
let loadPromise: Promise<{ profile: Profile; source: ProfileSource }> | null =
  null;

/**
 * Load the distribution profile once per session. Fails soft: any transport or
 * parse error resolves to the empty profile so the app still starts unbranded.
 */
export function loadProfile(): Promise<{
  profile: Profile;
  source: ProfileSource;
}> {
  if (!loadPromise) {
    loadPromise = profileLoadCmd({})
      .then((res) => {
        try {
          loaded = JSON.parse(res.json) as Profile;
          loadedError = null;
          loadedErrorSnippet = null;
        } catch (e) {
          console.warn("profile: failed to parse profile.json", e);
          loaded = EMPTY_PROFILE;
          const detail = describeJsonError(res.json, e);
          loadedError = detail.message;
          loadedErrorSnippet = detail.snippet ?? null;
        }
        loadedSource = (res.source as ProfileSource) ?? "default";
        loadedRoot = res.root ?? "";
        return { profile: loaded, source: loadedSource };
      })
      .catch((e) => {
        console.warn("profile: load failed", e);
        loadedError = e instanceof Error ? e.message : String(e);
        loadedErrorSnippet = null;
        return { profile: EMPTY_PROFILE, source: "default" as ProfileSource };
      });
  }
  return loadPromise;
}

// picoframe persists the theme mode/accent in these localStorage keys; its
// `defaultMode`/`defaultAccent` only seed them when unset. localStorage is keyed by
// app identifier and is NOT redirected by portable mode, so a bundled build can
// inherit a player's existing vanilla-Coilbox theme. Pre-writing these keys before
// first render makes the profile's brand authoritative on every launch.
const THEME_MODE_KEY = "picoframe.theme";
const ACCENT_KEY = "picoframe.accent";

/**
 * Force the profile's colour scheme (`mode`) and/or accent (`accent`) by seeding
 * picoframe's persisted theme keys before render. In-session changes via Appearance
 * still apply; they revert to the profile on the next launch. No-op for fields the
 * profile omits, so a user's own choice is untouched when the profile is silent.
 */
export function forceProfileTheme(): void {
  try {
    if (loaded.mode)
      localStorage.setItem(THEME_MODE_KEY, JSON.stringify(loaded.mode));
    if (loaded.accent)
      localStorage.setItem(ACCENT_KEY, JSON.stringify(loaded.accent));
  } catch {
    // localStorage unavailable (private mode / quota) — theme simply isn't forced.
  }
}

// The boot script in index.html reads this same localStorage key synchronously
// before first paint. Keep the string in sync with that inline script.
const BOOT_BACKGROUND_KEY = "coilbox.bootBackground";

/**
 * Apply the profile's {@link Profile.background} as the document background now (so
 * the current session stops showing white as soon as this runs) and cache it so the
 * `index.html` boot script can paint it before first paint on the next launch. When
 * the profile sets no background the cache is cleared, so a later unbranded run won't
 * inherit a stale colour.
 */
export function applyBootBackground(): void {
  const bg = loaded.background;
  try {
    if (bg) {
      document.documentElement.style.background = bg;
      localStorage.setItem(BOOT_BACKGROUND_KEY, bg);
    } else {
      localStorage.removeItem(BOOT_BACKGROUND_KEY);
    }
  } catch {
    // localStorage unavailable — the in-session background above still applied.
  }
}

// picoframe's AppLayout persists the sidebar-collapsed flag here (JSON boolean).
const SIDEBAR_COLLAPSED_KEY = "picoframe.sidebar.collapsed";

/**
 * Whether to seed the sidebar-collapsed flag: only when the profile asks for it
 * AND the user has no stored value yet. Pure so it's unit-testable; `existing` is
 * the raw `localStorage` string (or `null` when unset).
 */
export function shouldSeedCollapsed(
  existing: string | null,
  layout: ProfileLayout | undefined,
): boolean {
  return layout?.sidebarCollapsed === true && existing === null;
}

/**
 * Seed picoframe's sidebar-collapsed state from `layout.sidebarCollapsed` before
 * first render. A seed, not a lock: written only when the user has no stored value
 * (see {@link shouldSeedCollapsed}), so a returning user's choice persists. No-op
 * when the profile is silent or localStorage is unavailable.
 */
export function applyProfileSidebarSeed(): void {
  try {
    if (
      shouldSeedCollapsed(
        localStorage.getItem(SIDEBAR_COLLAPSED_KEY),
        loaded.layout,
      )
    )
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "true");
  } catch {
    // localStorage unavailable — the sidebar simply starts in its default state.
  }
}

/** The profile loaded at startup (empty until `loadProfile()` resolves). */
export function getProfile(): Profile {
  return loaded;
}

/** Where the loaded profile came from. */
export function getProfileSource(): ProfileSource {
  return loadedSource;
}

/**
 * Whether Coilbox's self-updater runs (profile `updater`, default true). Read by
 * the updater provider, which skips its launch check when this is false, and by the
 * Updates settings section. A lock, not a seed: there's no user toggle, because the
 * point is that the distributor owns the binary.
 */
export function isUpdaterEnabled(): boolean {
  return loaded.updater !== false;
}

/**
 * Whether the community hub is offered (profile `hub`, default true), so a
 * distributor shipping a modded game can withhold a button pointing at a
 * public gallery of other people's content.
 */
export function isHubEnabled(): boolean {
  return loaded.hub !== false;
}

/**
 * Whether the profile authoring tools are offered (profile `authoring`, default
 * true). Read by the Distribution profile settings section, which drops its reload
 * and scaffold controls when this is false.
 */
export function isProfileAuthoringEnabled(): boolean {
  return loaded.authoring !== false;
}

/** Curated map packs this profile ships (empty when it defines none). */
export function getProfileMapLists(): SuggestedMapList[] {
  return loaded.mapLists ?? [];
}

/** Map-exclusion rules this profile adds on top of the catalog's (empty when it
 * defines none). See `../content/mapEligibility`. */
export function getProfileMapExclusions(): MapExclusion[] {
  return loaded.excludedMaps ?? [];
}

/** The active onboarding placement for the branded home (see `onboarding`). */
export function getOnboardingPlacement(): OnboardingPlacement {
  return onboardingPlacement(loaded.onboarding);
}

/**
 * The portable root (`<app_dir>/.coilbox`) the profile was loaded from, or "" for
 * a non-portable install. Used to write an updated `profile.json` back into the
 * portable folder when a game release ships one.
 */
export function getProfileRoot(): string {
  return loadedRoot;
}

/**
 * The error from the last profile load, or `null` when it loaded (or was absent)
 * cleanly. A non-null value with source `"file"` means a `profile.json` was found
 * but couldn't be parsed — surfaced by the health panel so the failure isn't silent.
 */
export function getProfileError(): string | null {
  return loadedError;
}

/**
 * A monospace source excerpt (with a caret under the offending character) for the
 * last parse error, or `null` when there was no error or its location couldn't be
 * recovered from the engine's message. Rendered under the health panel's parse-error
 * row so a bundler can see exactly where the JSON broke.
 */
export function getProfileErrorSnippet(): string | null {
  return loadedErrorSnippet;
}

/**
 * Compile a {@link GameFilter} into a name predicate, or `null` when there's no
 * filter (callers then apply no scoping). Names are matched case-insensitively and
 * exactly; the regex is matched case-insensitively — same semantics the branding
 * catalog uses to key its Splinter Faction entry.
 */
export function makeGameMatcher(
  f?: GameFilter,
): ((name: string) => boolean) | null {
  if (!f || (!f.regex && !f.names?.length)) return null;
  let re: RegExp | undefined;
  if (f.regex) {
    try {
      re = new RegExp(f.regex, "i");
    } catch {
      console.warn("profile: gameFilter has an invalid regex, ignored");
    }
  }
  const names = f.names?.map((n) => n.toLowerCase());
  return (name: string) => {
    if (names?.includes(name.toLowerCase())) return true;
    return re?.test(name) ?? false;
  };
}

/**
 * The active game-name predicate from the profile's `gameFilter`, or `null` when
 * none is set. Stable for the session (the profile is loaded once), so it's safe to
 * call at module or render scope without memoization concerns.
 */
export function getGameMatcher(): ((name: string) => boolean) | null {
  return makeGameMatcher(loaded.gameFilter);
}
