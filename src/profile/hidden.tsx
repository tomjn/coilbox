import { NavGate } from "@picoframe/frame";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import type { ComponentType } from "react";
import { getProfile } from "./profile";

/**
 * Nav hiding driven by the distribution profile's `hide` list. A bundled build can
 * remove top-level features it doesn't want (e.g. `downloads.games`) by id, without
 * a fork. Mirrors the Advanced-mode gating in `../general/advanced`, but the source
 * is the read-once profile rather than a live user setting — so these are plain
 * predicates (not reactive hooks): the profile can't change during the session.
 *
 * A hideable nav item opts in by referencing `isProfileHidden(id)` in its
 * `useVisible`; its route opts in via `gateProfileHidden(id, loader)`.
 */

/**
 * Is this nav item hidden by the active profile? `false` for every id when no
 * profile is loaded. Safe to call inside a nav item's `useVisible` — it reads a
 * static module value, so it needn't (and doesn't) use React state.
 */
export function isProfileHidden(id: string): boolean {
  return getProfile().hide?.includes(id) ?? false;
}

/** Is this settings section hidden by the active profile? */
export function isSettingsHidden(id: string): boolean {
  return getProfile().hideSettings?.includes(id) ?? false;
}

/**
 * Inject a profile-driven `useVisible` into every plugin's settings sections, so a
 * bundled distribution can hide settings by id (`hideSettings`) without each plugin
 * opting in. Uses the `SettingsSection.useVisible` gate added in plugin-sdk 0.0.7;
 * composes with any existing predicate (evaluated unconditionally to respect the
 * rules of hooks). No-op when the profile hides no settings, so vanilla is untouched
 * and no section gains a hook it wouldn't otherwise have.
 *
 * Note: this is presentational (hides from the settings nav); a hidden section stays
 * reachable by direct `/settings/<id>` link — the frame has no settings route gate.
 */
export function applyProfileSettingsHiding(
  plugins: FramePlugin[],
): FramePlugin[] {
  if (!getProfile().hideSettings?.length) return plugins;
  return plugins.map((p) =>
    p.settings?.length
      ? {
          ...p,
          settings: p.settings.map((s) => {
            const base = s.useVisible;
            return {
              ...s,
              useVisible: () =>
                (base ? base() : true) && !isSettingsHidden(s.id),
            };
          }),
        }
      : p,
  );
}

/**
 * Wrap a route's lazy loader so its page redirects home when the profile hides
 * `id` — mirroring the item's `useVisible`, so a deep-linked/bookmarked route for a
 * hidden feature isn't reachable.
 */
export function gateProfileHidden(
  id: string,
  loader: () => Promise<{ default: ComponentType }>,
): () => Promise<{ default: ComponentType }> {
  return async () => {
    const { default: Page } = await loader();
    function GatedProfilePage() {
      return (
        <NavGate use={() => !isProfileHidden(id)}>
          <Page />
        </NavGate>
      );
    }
    return { default: GatedProfilePage };
  };
}
