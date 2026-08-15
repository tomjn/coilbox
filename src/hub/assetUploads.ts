/**
 * Agreeing to send pictures off this machine (issue #1635).
 *
 * Coilbox can read the game and map archives on this computer, render pictures
 * from what is inside them, and upload those pictures to the hub as the
 * signed-in account. That is off until somebody turns it on, and this is the
 * frontend half of asking.
 *
 * The half that matters is in Rust, at
 * `crates/tauri-plugin-coilbox-hub/src/consent.rs`, which reads this same
 * setting and the distribution profile off disk before any upload path runs. So
 * this module is what the reader sees and not what stops anything: turning the
 * switch off here and calling an upload anyway gets refused by the plugin.
 *
 * Off by default rather than opt-out, for three reasons that stack. The pictures
 * are derived from other people's game and map archives, and not every archive
 * is clear about what may be done with what is inside it. An upload is
 * attributed to the account that made it and lands in a public repository with
 * permanent history, so a mistake is much harder to undo than deleting a file.
 * And each upload spends storage the whole community shares.
 */

import { useSetting } from "@picoframe/frame";
import { readStoredSetting } from "@/lib/storedSetting";
import { isHubAssetUploadOffered } from "@/profile/profile";

/**
 * Where the answer is stored. The same string as `SETTING_KEY` in the plugin's
 * `consent.rs`, which reads the frame's settings file directly: change one and
 * the other stops seeing the answer.
 */
export const ASSET_UPLOAD_SETTING_KEY = "hub.assetUploads";

/**
 * The whole decision, from the two things that make it. Pure, and the same order
 * as `permitted` in `consent.rs`: a distribution can only say no, and it says it
 * last, so a switch turned on before the profile arrived does not survive one.
 */
export function assetUploadsAllowed(
  agreed: boolean,
  offeredByProfile: boolean,
): boolean {
  return offeredByProfile && agreed;
}

/**
 * The switch itself: whether the player has agreed, and how to change it.
 *
 * The answer alone, without the profile. A distribution that has switched
 * uploads off hides the control rather than flipping the player's saved answer,
 * so the answer is still theirs if the profile goes away again.
 */
export function useAssetUploadConsent() {
  return useSetting<boolean>(ASSET_UPLOAD_SETTING_KEY, false);
}

/**
 * Whether an upload would be permitted, for anything outside a React render
 * (the settings store is read directly, the way `readStoredSetting`'s other
 * callers do). Advisory only: it saves offering an action that the plugin would
 * refuse, and the refusal is the plugin's either way.
 */
export function assetUploadsPermitted(): boolean {
  return assetUploadsAllowed(
    readStoredSetting<boolean>(ASSET_UPLOAD_SETTING_KEY, false),
    isHubAssetUploadOffered(),
  );
}
