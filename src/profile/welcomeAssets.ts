import { assetUrl, isLocalRef } from "../lib/assetUrl";

/**
 * Rewrite relative asset references in the trusted, bundler-authored profile welcome
 * HTML/CSS so `<img src="images/x.jpg">`, `background: url(images/x.gif)` and
 * `@font-face { src: url(fonts/x.woff2) }` resolve against the portable `.coilbox/`
 * folder via the `coilbox://` protocol — instead of (uselessly) against the app
 * origin. Only *local* refs are touched; absolute URLs, data/blob URIs and app-
 * absolute `/…` paths are left as-is (see {@link isLocalRef}).
 *
 * The HTML is already injected via `dangerouslySetInnerHTML` as trusted content, so
 * this rewrite adds no new trust surface — it only fixes URL resolution.
 */

/** Rewrite every `url(...)` in a CSS string whose target is a local ref. */
export function rewriteBrandedCss(css: string): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote: string, url: string) =>
      isLocalRef(url) ? `url(${quote}${assetUrl(url)}${quote})` : match,
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
      if (value && isLocalRef(value)) el.setAttribute(attr, assetUrl(value));
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
