import type { Accent, ThemeMode } from "@picoframe/frame";
import { defineCommand } from "@picoframe/plugin-sdk";

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
  /** Raw HTML rendered into the welcome page body. */
  html?: string;
  /** CSS injected alongside the welcome HTML. */
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

export interface Profile {
  version: number;
  /** Window + in-app title, e.g. "Splinter Faction - Coilbox". */
  title?: string;
  /** Nav item ids to hide from the sidebar/launcher, e.g. ["downloads.games"]. */
  hide?: string[];
  /** Settings section ids to hide from the settings nav, e.g. ["uberstress"]. */
  hideSettings?: string[];
  /** Preset filter narrowing battle/game lists to one game. */
  gameFilter?: GameFilter;
  /** Branded landing page shown in place of the default launcher. */
  welcome?: WelcomeConfig;
  /** External links added to the sidebar/launcher, e.g. a Discord invite. */
  links?: LinkConfig[];
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
  /** GitHub repo ("owner/name") whose latest release ships this game's archive. */
  release?: { repo: string };
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

const EMPTY_PROFILE: Profile = { version: 1 };

// Module singletons: populated by loadProfile() before first render (main.tsx
// awaits it), so getProfile()/getProfileSource() can be read synchronously
// anywhere afterwards — the same pattern the settings cache uses.
let loaded: Profile = EMPTY_PROFILE;
let loadedSource: ProfileSource = "default";
let loadedRoot = "";
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
        } catch (e) {
          console.warn("profile: failed to parse profile.json", e);
          loaded = EMPTY_PROFILE;
        }
        loadedSource = (res.source as ProfileSource) ?? "default";
        loadedRoot = res.root ?? "";
        return { profile: loaded, source: loadedSource };
      })
      .catch((e) => {
        console.warn("profile: load failed", e);
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

/** The profile loaded at startup (empty until `loadProfile()` resolves). */
export function getProfile(): Profile {
  return loaded;
}

/** Where the loaded profile came from. */
export function getProfileSource(): ProfileSource {
  return loadedSource;
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
