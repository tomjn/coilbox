/**
 * Fetch a remote import payload for a `coilbox://import?url=<https url>` deep
 * link, then gate it through the same `identify()` path an inline code uses
 * (issue #482, follows on from #388 and #479).
 *
 * A fetch-URL import is a network trust boundary and higher risk than an inline
 * code: the link comes from outside the app (Discord, lobby chat) and pulls
 * content from a remote host. The fetch itself runs on the Rust side (the
 * `dl_fetch_text` command), for two reasons:
 *
 * - A webview `fetch` is subject to CORS, so it only reaches hosts that send
 *   permissive CORS headers. Most paste and gist hosts do not, so a browser
 *   fetch would fail for the very URLs people share. The Rust client has no such
 *   limit.
 * - The byte cap, https check, and timeout live where the bytes arrive, so an
 *   oversized or slow response is cut off before it is ever buffered in full.
 *
 * This module orchestrates: it re-checks https (defence in depth), calls the
 * injected fetcher, then runs the returned text through `prepareImport` (which
 * calls `identify`). Unknown content is rejected, a newer-version container is
 * carried through with a warning. Nothing here applies an import: it returns a
 * plan the handler confirms with the user, and the fetch only runs after the
 * user has agreed to contact the host.
 *
 * The fetcher is injected so the orchestration and the `identify` gating are
 * unit-testable without a real network.
 */

import { type ImportPlan, prepareImport } from "./actions";

/** Largest shared import payload we will read. Mirrors `IMPORT_FETCH_LIMIT` in
 * the downloads plugin (`lib.rs`), which enforces it while streaming. Kept here
 * only for documentation and any pre-flight caller. */
export const MAX_IMPORT_BYTES = 512 * 1024;

/** Fetch a URL's body as text, or a reason it could not be read. In production
 * this wraps the `dl_fetch_text` Rust command, which enforces https, a byte cap
 * and a timeout. Tests inject a stub. */
export type FetchText = (url: string) => Promise<FetchTextResult>;

export type FetchTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export type FetchImportResult =
  | { ok: true; plan: ImportPlan; host: string }
  | { ok: false; reason: string };

/** Pull the host out of a URL for user-facing messages, or the raw URL if it
 * somehow will not parse (it already parsed once in `parse.ts`). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Fetch a URL's text via `fetchText`, then classify it with `prepareImport`.
 * Returns a ready-to-confirm plan, or a clear reason it was rejected. Never
 * throws.
 */
export async function fetchImportPlan(
  url: string,
  fetchText: FetchText,
): Promise<FetchImportResult> {
  const host = hostOf(url);

  // Defence in depth: parse.ts already enforced https, but never fetch a
  // non-https URL even if this is reached another way.
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return { ok: false, reason: "This import URL is not valid." };
  }
  if (scheme !== "https:") {
    return { ok: false, reason: "Import URLs must be https." };
  }

  const fetched = await fetchText(url);
  if (!fetched.ok) {
    return { ok: false, reason: fetched.reason };
  }

  const prepared = prepareImport(fetched.text);
  if (!prepared.ok) {
    return { ok: false, reason: prepared.reason };
  }
  return { ok: true, plan: prepared.plan, host };
}
