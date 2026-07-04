import { NavGate, useSetting } from "@picoframe/frame";
import type { ComponentType } from "react";
import { getProfile } from "../profile/profile";

/**
 * "Advanced mode" hides the developer/modding tools (uberstress, mapconv,
 * animation, and the archive explorer) behind a single General-settings toggle,
 * leaving a player-focused layout (content, single/multiplayer, replays) by
 * default. The flag lives in the frame settings store under one key so reader and
 * writer can't drift.
 */
const ADVANCED_MODE_KEY = "advanced.enabled";

/**
 * `[enabled, setEnabled]` for the General settings toggle. The default seeds from
 * the distribution profile (`profile.advanced`) so a branded build can ship with
 * the developer/modding tools on; a user's persisted toggle shadows it thereafter.
 */
export function useAdvancedModeSetting() {
  return useSetting<boolean>(ADVANCED_MODE_KEY, getProfile().advanced ?? false);
}

/**
 * Nav/route predicate: is advanced mode on? Passed to advanced nav items'
 * `useVisible` (hides them from the sidebar and welcome launcher) and to
 * `gateAdvanced` (redirects their routes home while hidden).
 */
export function useAdvancedMode(): boolean {
  return useAdvancedModeSetting()[0];
}

/**
 * Wrap a plugin route's lazy loader so its page redirects home when advanced mode
 * is off — mirroring the item's `useVisible` so a bookmarked/deep-linked advanced
 * route isn't reachable in player-focused mode.
 */
export function gateAdvanced(
  loader: () => Promise<{ default: ComponentType }>,
): () => Promise<{ default: ComponentType }> {
  return async () => {
    const { default: Page } = await loader();
    function GatedAdvancedPage() {
      return (
        <NavGate use={useAdvancedMode}>
          <Page />
        </NavGate>
      );
    }
    return { default: GatedAdvancedPage };
  };
}
