import { assetUrl, isLocalRef } from "../lib/assetUrl";
import { parseRef } from "./refs";

/**
 * Rewrite relative asset references in the trusted, bundler-authored profile welcome
 * HTML/CSS so `<img src="images/x.jpg">`, `background: url(images/x.gif)` and
 * `@font-face { src: url(fonts/x.woff2) }` resolve against the portable `.coilbox/`
 * folder via the `coilbox://` protocol — instead of (uselessly) against the app
 * origin. Only *local* refs are touched; absolute URLs, data/blob URIs and app-
 * absolute `/…` paths are left as-is (see {@link isLocalRef}). An `@`-reference is
 * a Coilbox reference rather than a path, and gets its own treatment (see
 * {@link rewrittenUrl}).
 *
 * The HTML is already injected via `dangerouslySetInnerHTML` as trusted content, so
 * this rewrite adds no new trust surface — it only fixes URL resolution.
 */

/**
 * What one URL in the markup should be rewritten to, or `undefined` to leave it as
 * the author wrote it. The single decision behind both rewrites below.
 *
 * A value starting with `@` is a Coilbox reference, `@<namespace>/<rest>` as parsed
 * by {@link parseRef}, and not a file path, so pasting the whole token into a
 * `coilbox://` URL is wrong. That is what turned `href="@route/replays"` into
 * `coilbox://localhost/portable/%40route/replays`, which the click handler could
 * no longer recognise as a route, so a navigate marker relying on its `href` never
 * navigated (issue #1048).
 *
 * Only the `.coilbox` namespace names a file, and it names the path *after* the
 * namespace, so that is the part the asset URL is built from. `@route/` and
 * `@widget/` name something inside the app, so they pass through untouched and
 * reach the click handler as written. Anything else beginning with `@` is not a
 * reference at all, and is left alone rather than turned into an asset URL that
 * cannot resolve.
 */
export function rewrittenUrl(value: string): string | undefined {
  if (value.trim().startsWith("@")) {
    const ref = parseRef(value);
    return ref?.kind === "file" ? assetUrl(ref.path) : undefined;
  }
  return isLocalRef(value) ? assetUrl(value) : undefined;
}

/** Rewrite every `url(...)` in a CSS string whose target is a local ref. */
export function rewriteBrandedCss(css: string): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote: string, url: string) => {
      const rewritten = rewrittenUrl(url);
      return rewritten ? `url(${quote}${rewritten}${quote})` : match;
    },
  );
}

// URL-bearing attributes an author might use in welcome HTML (img/source/video/
// audio/link). `srcset` is intentionally out of scope — welcome art is single-source.
const URL_ATTRS = ["src", "href", "poster"];

/** Rewrite local `src`/`href`/`poster`, inline `style` url()s and `<style>` blocks. */
export function rewriteBrandedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    for (const attr of URL_ATTRS) {
      const value = el.getAttribute(attr);
      const rewritten = value ? rewrittenUrl(value) : undefined;
      if (rewritten) el.setAttribute(attr, rewritten);
    }
    const style = el.getAttribute("style");
    if (style?.toLowerCase().includes("url(")) {
      el.setAttribute("style", rewriteBrandedCss(style));
    }
  }
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    styleEl.textContent = rewriteBrandedCss(styleEl.textContent ?? "");
  }
  return doc.body.innerHTML;
}
