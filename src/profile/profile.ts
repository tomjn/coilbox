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
