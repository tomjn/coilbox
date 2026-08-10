/**
 * The production text fetcher every remote import goes through: it wraps the
 * `dl_fetch_text` Rust command (which enforces https, a byte cap and a timeout)
 * and maps its thrown error into the `FetchText` result shape
 * `fetchImportPlan` expects. The fetch runs Rust-side to bypass the webview's
 * CORS limits (see `fetchImport.ts`).
 *
 * Its own module rather than a private const in `DeepLinkHandler.tsx`, because
 * the hub's item page fetches a container the same way (issue #1366) and must
 * not pull a screenful of dialog components in behind it.
 */

import { dlFetchText } from "../downloads/bindings";
import type { FetchText } from "./fetchImport";

export const fetchImportText: FetchText = async (url) => {
  try {
    const { text } = await dlFetchText({ url });
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
};
