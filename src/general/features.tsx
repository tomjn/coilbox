import { NavGate, useSetting } from "@picoframe/frame";
import type { ComponentType } from "react";
import { getProfile } from "../profile/profile";

/**
 * Feature toggles: each group of making and developer tools is switched on on its
 * own in Settings > General, so a player who makes maps is not shown unit tools.
 * All are off by default, which leaves the player-focused layout.
 *
 * They replaced a single "Advanced mode" switch stored at `advanced.enabled`.
 * That key is still read, as the default for every toggle, so anyone who had
 * advanced mode on keeps every tool until they change a toggle themselves.
 */
export const FEATURES = [
  "mapping",
  "units",
  "animation",
  "archives",
  "missions",
  "uberstress",
] as const;

export type Feature = (typeof FEATURES)[number];

/** The setting the old single switch was stored under. Read, never written. */
const LEGACY_ADVANCED_KEY = "advanced.enabled";

const featureKey = (feature: Feature) => `features.${feature}`;

/**
 * What a toggle starts as when the player has never set it: the profile's own
 * answer for that feature, else the profile's `advanced`, which means all of
 * them, else off.
 */
export function profileFeatureDefault(feature: Feature): boolean {
  const profile = getProfile();
  return profile.features?.[feature] ?? profile.advanced ?? false;
}

/**
 * `[enabled, setEnabled]` for one toggle. A stored choice wins. Without one, the
 * old advanced switch decides, and without that the profile does.
 */
export function useFeatureSetting(feature: Feature) {
  const [legacy] = useSetting<boolean>(
    LEGACY_ADVANCED_KEY,
    profileFeatureDefault(feature),
  );
  return useSetting<boolean>(featureKey(feature), legacy);
}

/** Is this feature switched on? */
export function useFeature(feature: Feature): boolean {
  return useFeatureSetting(feature)[0];
}

/** Every toggle's current state, for the profile writer. */
export function useFeatureStates(): Record<Feature, boolean> {
  return {
    mapping: useFeature("mapping"),
    units: useFeature("units"),
    animation: useFeature("animation"),
    archives: useFeature("archives"),
    missions: useFeature("missions"),
    uberstress: useFeature("uberstress"),
  };
}

const visibilityHooks = new Map<Feature, () => boolean>();

/**
 * A nav item's `useVisible` for a feature. Each feature gets one function, made
 * once, so every item gated on it passes the same hook.
 */
export function featureVisible(feature: Feature): () => boolean {
  let hook = visibilityHooks.get(feature);
  if (!hook) {
    hook = () => useFeature(feature);
    visibilityHooks.set(feature, hook);
  }
  return hook;
}

/**
 * Wrap a plugin route's lazy loader so its page redirects home while the
 * feature is off, matching the nav item's `useVisible`, so a bookmark or deep
 * link cannot reach a tool the player has switched off.
 */
export function gateFeature(
  feature: Feature,
  loader: () => Promise<{ default: ComponentType }>,
): () => Promise<{ default: ComponentType }> {
  return async () => {
    const { default: Page } = await loader();
    function GatedFeaturePage() {
      return (
        <NavGate use={featureVisible(feature)}>
          <Page />
        </NavGate>
      );
    }
    return { default: GatedFeaturePage };
  };
}
