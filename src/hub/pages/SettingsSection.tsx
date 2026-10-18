import { useHubUrl } from "../config";
import { ShareAssetsPanel } from "./components/ShareAssetsPanel";

/**
 * The hub plugin's settings section (`/settings/hub`, issue #1353): signing in and
 * the sharing controls. Reachable only while the hub is enabled (see the
 * `useVisible` gate on this section in `../index.tsx`), because a distributor who
 * has switched the hub off has nothing here to sign in to.
 *
 * Which hub coilbox talks to is set in Settings > Library > Sources
 * (`./components/HubAddressField.tsx`, issue #4584). Signing in (issue #1348) sits
 * here because which hub you are pointed at decides which account you have.
 * Changing the address asks the new hub who you are there.
 *
 * The import count (issue #1361) had a switch here and no longer does. It read
 * as a preference rather than as the one thing coilbox sends home, and what it
 * withheld was an item id the hub had just served, with no account and nothing
 * that points at the reader. See `../importCount.ts`. A distribution can still
 * switch the whole thing off with `hubImportCounts`.
 *
 * Signing in and the four sharing controls themselves are `ShareAssetsPanel`
 * (`./components/ShareAssetsPanel.tsx`), shared with the hub page's Share menu
 * (issue #2562) so the same panel does the work wherever it is opened from.
 */
export default function HubSettings() {
  return <ShareAssetsPanel hubUrl={useHubUrl()} />;
}
