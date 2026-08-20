import { assetUrl, isLocalRef } from "../lib/assetUrl";
import { slugFromPath } from "./pages";
import { parseRef } from "./refs";

/**
 * Where a markdown link in a custom page points, once the `@`-reference scheme and the
 * ".md links resolve to their page route" convention (issue #274) are applied. Pure and
 * unit-tested here. The `a` renderer in CustomPage turns each kind into the right action:
 * a system-browser open, in-app navigation, or a scroll down the page.
 */
export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "route"; to: string }
  // `path` is the same `.coilbox`-relative path `url` was built from, kept so a
  // click can point the file manager at the file. The `coilbox://` URL is not a
  // filesystem path and nothing outside the webview can follow it.
  | { kind: "asset"; url: string; path: string }
  | { kind: "anchor"; href: string }
  | { kind: "inert" };

/**
 * Classify a markdown link `href`:
 * - `http(s)/mailto/tel` → external (opened in the system browser, never the webview).
 * - `#frag` → an in-page anchor, which the click scrolls to (issue #1805).
 * - `@route/<path>` → an in-app route.
 * - `@.coilbox/<f>.md` or a plain `*.md` link → the page route `pages/<slug>` (slug from
 *   the filename, so `intro.md` → `/pages/intro`; a nested page links via `@route/...`).
 * - an app-absolute `/path` → an in-app route (a desktop SPA has no external `/` links,
 *   and a raw `<a href="/x">` would blow away the app).
 * - `@.coilbox/<other>` or a plain local ref → a `coilbox://` asset URL.
 * - a `@widget/...`/malformed ref, or anything else → inert (rendered without a link).
 */
export function classifyMarkdownLink(href: string | undefined): LinkTarget {
  const h = href?.trim();
  if (!h) return { kind: "inert" };
  if (/^(https?:|mailto:|tel:)/i.test(h)) return { kind: "external", url: h };
  if (h.startsWith("#")) return { kind: "anchor", href: h };

  if (h.startsWith("@")) {
    const ref = parseRef(h);
    if (ref?.kind === "route") return { kind: "route", to: ref.to };
    if (ref?.kind === "file") {
      return /\.md$/i.test(ref.path)
        ? { kind: "route", to: `/pages/${slugFromPath(ref.path)}` }
        : { kind: "asset", url: assetUrl(ref.path), path: ref.path };
    }
    return { kind: "inert" };
  }

  if (/\.md$/i.test(h))
    return { kind: "route", to: `/pages/${slugFromPath(h)}` };
  if (h.startsWith("/")) return { kind: "route", to: h };
  if (isLocalRef(h)) return { kind: "asset", url: assetUrl(h), path: h };
  return { kind: "inert" };
}
