/**
 * Telling the hub that an import from a hub link finished (issue #1361). The
 * hub wants to show how many times an item has been imported, and it is the one
 * thing it cannot work out for itself: it sees the fetch of `/i/<id>`, but
 * coilbox asks the reader to confirm before applying anything, so a fetch that
 * ends at the confirm dialog is not an import. Only coilbox knows which of the
 * two happened.
 *
 * This is the first thing coilbox sends home, so it is kept to the smallest
 * thing that answers the question. `POST /api/v1/items/{id}/imported` carries no
 * body, no account, no token and no identifier of any kind beyond the item id
 * that was already in the address the reader followed. There is nothing to
 * version, so the hub answers 204 with no body rather than the `format`/
 * `version` envelope the read routes use, and 404 for an id that never existed
 * or has been withdrawn. Nothing here reads the answer either way.
 *
 * Three things have to be true before anything is sent, all of them in
 * {@link importCountUrl}:
 *
 * - The import came from a hub link, so there is an item id. A pasted share code
 *   and an imported file carry none, and there is nothing to invent.
 * - There is a hub this session trusts. A profile that switched the hub off has
 *   no configured hub, and a link to the address it used to use is a stranger's.
 * - Counting is switched on, by both the reader and the distribution.
 *
 * The request runs in the webview, like the reads in `./api` and unlike the
 * publish in `./publish`. Publishing goes through Rust because that is where the
 * access token lives and no token crosses the IPC boundary. This request has no
 * token, no secret and no answer worth reading, and the hub sends
 * `access-control-allow-origin: *`, so a plain fetch is the honest shape for it.
 */

import { useSetting } from "@picoframe/frame";
import { useCallback, useRef } from "react";
import { isHubImportCountEnabled } from "@/profile/profile";
import { useTrustedHubUrl } from "./config";

/** The setting the reader's choice persists under. On unless turned off. */
export const HUB_COUNT_IMPORTS_KEY = "hub.countImports";

/** The reader's "tell the hub when an import finishes" setting. */
export function useCountHubImportsSetting() {
  return useSetting<boolean>(HUB_COUNT_IMPORTS_KEY, true);
}

/**
 * Where to report an import of `hubItemId`, or null when there is nothing to
 * report. Pure, and the whole of the decision: every reason not to send is a
 * null here rather than a branch at the call site.
 *
 * `hubUrl` is {@link useTrustedHubUrl}'s answer, so null already means a
 * distribution with the hub switched off. The path is concatenated onto the
 * base the same way `hubItemUrl` builds its addresses, so a hub served under a
 * path prefix keeps it.
 */
export function importCountUrl(
  hubItemId: string | undefined,
  hubUrl: string | null,
  counting: boolean,
): string | null {
  if (!hubItemId || !hubUrl || !counting) return null;
  const base = hubUrl.replace(/\/+$/, "");
  return `${base}/api/v1/items/${encodeURIComponent(hubItemId)}/imported`;
}

/**
 * Send the count, and forget about it. Nothing waits on this and nothing reads
 * what comes back: the import has already succeeded, the reader has what they
 * asked for, and a hub that is asleep, unreachable or has withdrawn the item is
 * not something anybody needs telling about.
 */
export function reportImport(url: string | null): void {
  if (!url) return;
  void fetch(url, { method: "POST" }).catch(() => undefined);
}

/**
 * Report a finished import, for `useRecordHubImport` to call at the one point
 * that knows an import completed and which item it was. Hands back a function
 * rather than doing it, because the hub address and the settings are React state
 * and the import finishes inside a callback.
 *
 * The address and the setting are read through a ref, so this function keeps the
 * same identity for as long as an importer's drawer holds it, for the same
 * reason `useRecordHubImport` does it.
 */
export function useReportHubImport(): (hubItemId: string | undefined) => void {
  const hubUrl = useTrustedHubUrl();
  const [counting] = useCountHubImportsSetting();
  const latest = useRef({ hubUrl, counting });
  latest.current = { hubUrl, counting };
  return useCallback((hubItemId: string | undefined) => {
    const { hubUrl, counting } = latest.current;
    const allowed = counting && isHubImportCountEnabled();
    reportImport(importCountUrl(hubItemId, hubUrl, allowed));
  }, []);
}
