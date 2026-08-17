/**
 * Read a file the app serves back as a base64 `data:` URL.
 *
 * Caches hand pictures to the page as `coilbox://` file names rather than base64
 * (issue #1694), which is what a page wants and an export cannot use: what an
 * export writes leaves this machine, so the bytes have to travel with it. This
 * is the way back, used at those few points only.
 */

import { toBase64 } from "./base64";

/**
 * Fetch `url` and return its bytes as a `data:` URL, carrying the content type
 * the response declared. `undefined` for anything that will not read, so one
 * missing picture is a gap in an export rather than a failed export.
 */
export async function fetchAsDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const mime = res.headers.get("content-type") || "application/octet-stream";
    return `data:${mime};base64,${toBase64(new Uint8Array(await res.arrayBuffer()))}`;
  } catch {
    return undefined;
  }
}
