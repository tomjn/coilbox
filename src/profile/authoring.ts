import type { Accent, ThemeMode } from "@picoframe/frame";
import { defineCommand } from "@picoframe/plugin-sdk";
import { withoutGeneratedGames } from "../lib/generatedGames";
import type { Profile } from "./profile";

/** One game from a unitsync scan, reduced to what naming it needs. */
export interface ScannedGame {
  name: string;
  primaryArchive: { name: string };
}

/**
 * Profile authoring: the writer half of the distribution-profile feature (issue #406).
 * Until now `profile.json` was hand-written blind and only read at boot, so every edit
 * cost a full app restart. This module backs two controls in the Distribution profile
 * settings section:
 *
 * - {@link reloadProfile} re-reads the file and re-applies it without restarting the app.
 * - {@link scaffoldProfile} writes a starter `profile.json` from the app's current state.
 *
 * Both are gated on the profile's `authoring` flag (see `isProfileAuthoringEnabled`), so
 * a shipped distribution can take them away.
 */

const profileScaffoldCmd = defineCommand<
  { json: string },
  { path: string; written: boolean }
>("coilbox-profile", "profile_scaffold");

/**
 * Re-apply the profile from disk by reloading the webview. The whole boot pipeline in
 * `main.tsx` runs again against the edited file, so every field lands exactly as it
 * would on a real launch: theme, hidden nav, layout chrome, links, custom pages,
 * welcome, splash. Re-applying only the handful of appliers that can run post-render
 * would leave the rest stale, which is a worse preview than none.
 *
 * The Rust side keeps running (this is not an app restart) and picoframe routes on the
 * URL hash, so the author lands back on the page they were previewing.
 */
export function reloadProfile(): void {
  location.reload();
}

/** The live app state {@link buildScaffoldProfile} turns into a starter profile. */
export interface ScaffoldInputs {
  /** The in-app title, i.e. the current profile's `title` or "Coilbox". */
  title: string;
  /** The colour scheme currently in effect. */
  mode: ThemeMode;
  /** The accent currently in effect. */
  accent: Accent;
  /** Whether advanced (developer/modding) mode is on. */
  advanced: boolean;
  /** Whether the window is set to open fullscreen. */
  fullscreen: boolean;
  /** Games the unitsync scan found, by the name a `gameFilter` would match. */
  installedGames: string[];
}

/**
 * Compose a starter profile from the app's current state. Emits the knobs an author
 * would otherwise have to look up, already set to what they can see on screen, plus
 * empty `hide`/`hideSettings` lists as a prompt to fill in. `gameFilter` is seeded only
 * when exactly one game is installed, where the intent is unambiguous. `authoring` is
 * written explicitly (rather than left to its default) so the switch that hides these
 * controls in a shipped build is discoverable in the file itself.
 */
export function buildScaffoldProfile(i: ScaffoldInputs): Profile {
  const profile: Profile = {
    version: 1,
    title: i.title,
    mode: i.mode,
    accent: i.accent,
    advanced: i.advanced,
    fullscreen: i.fullscreen,
  };
  if (i.installedGames.length === 1)
    profile.gameFilter = { names: [i.installedGames[0]] };
  profile.hide = [];
  profile.hideSettings = [];
  profile.authoring = true;
  return profile;
}

/** Serialize a scaffolded profile the way a human would hand-write it. */
export function serializeProfile(profile: Profile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/**
 * The installed games a `gameFilter` may name, from a unitsync scan.
 *
 * A scan rather than the `games/` file listing, because a filter matches the name
 * unitsync reports and a file name is a different string: seeding
 * `SplinterFaction_0.1.78.sdz` writes a filter that matches nothing anywhere the
 * profile is applied. It is also the only answer to "is this game installed" the
 * app trusts, since an archive on disk that unitsync refuses is not a game.
 *
 * Coilbox's own generated games are taken out (issue #959). They are rewritten on
 * every test launch, so a profile pinned to one is pinned to a folder that moves.
 */
export function installedGameNames(games: readonly ScannedGame[]): string[] {
  return withoutGeneratedGames(games).map((g) => g.name);
}

/** Where a scaffold attempt landed. `written` is false when a profile was already there. */
export interface ScaffoldResult {
  path: string;
  written: boolean;
}

/**
 * Write a starter `profile.json` into `<app_dir>/.coilbox/`. Never overwrites an
 * existing profile (the Rust side reports `written: false` instead). Rejects when the
 * folder can't be written.
 *
 * The new file only takes effect after a full app restart, not a webview reload: Rust
 * memoizes the portable root at first use, and a `.coilbox` without a `profile.json`
 * isn't a portable root at all, so the process that scaffolds one still believes it is
 * a non-portable install.
 */
export async function scaffoldProfile(
  profile: Profile,
): Promise<ScaffoldResult> {
  return profileScaffoldCmd({ json: serializeProfile(profile) });
}
