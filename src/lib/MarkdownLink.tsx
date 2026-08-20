import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

/** The three `href` schemes that belong to another program rather than to Coilbox. */
const EXTERNAL = /^(https?:|mailto:|tel:)/i;
/** The Windows spelling of a `coilbox://` asset URL, which reads as an `http:` one. */
const ASSET_URL = /^https?:[/][/]coilbox[.]localhost[/]/i;

/**
 * True for a link the OS can open beside Coilbox: `https:`, `http:`, `mailto:`
 * and `tel:`. These are also exactly the four schemes `opener:default` permits,
 * so nothing here can ask for more than the capability grants.
 *
 * The Windows asset URL is spelled `http://coilbox.localhost/…` rather than
 * `coilbox://…` (see {@link ./assetUrl}), so it has to be excluded by hand or the
 * `http:` rule lets a bundled file through on Windows only.
 */
export function isExternalLink(href: string): boolean {
  const h = href.trim();
  return EXTERNAL.test(h) && !ASSET_URL.test(h);
}

interface MarkdownLinkProps {
  href?: string;
  title?: string;
  children?: ReactNode;
}

/**
 * The `a` renderer for a `react-markdown` surface whose text is not the app's own
 * (issue #1789): a mission briefing written by whoever made the campaign, a
 * changelog written by whoever cut the release.
 *
 * Coilbox has no back button and no address bar, so an `<a href>` the webview is
 * allowed to follow takes the whole app off screen and only a restart brings it
 * back. That is the same stranding fixed for the welcome screen in #1062, the
 * home page's markup in #1777 and a distribution's pages in #1783. So the click
 * never reaches the webview here either. An external link goes to the OS, which
 * opens it beside Coilbox in a program that does have a back button, and anything
 * else is refused and named in the console.
 *
 * Refusing the rest rather than resolving it, which is what makes this the small
 * renderer and not {@link ../profile/CustomPage}'s. A distribution page is
 * written by whoever packaged the app, so its links are worth resolving into
 * in-app routes and bundled files. These two surfaces have no such scheme to
 * offer and no reason to grow one: a briefing already shows a bundled picture
 * through the image spelling, and a changelog only ever wants its links opened.
 * A bare `#fragment` is refused with the rest, because Coilbox routes on the hash
 * and following one would move the app rather than scroll the text.
 *
 * `source` names the surface in the console warning, so an author who wrote the
 * link can tell which of their files it came from.
 */
export function externalOnlyLink(source: string) {
  return function MarkdownLink({ href, title, children }: MarkdownLinkProps) {
    const url = href?.trim() ?? "";
    return (
      <a
        href={href}
        title={title}
        onClick={(e) => {
          // First, before anything that can throw: whatever else goes wrong, the
          // webview must not be left to follow the link.
          e.preventDefault();
          if (isExternalLink(url)) {
            // A rejection is logged and swallowed, as everywhere else the app
            // opens a link: the reader asked to leave, and Coilbox has nothing to
            // show them if the OS refuses.
            openUrl(url).catch((err) =>
              console.warn(`${source}: could not open the link "${url}"`, err),
            );
            return;
          }
          // Say which link it was: a click that silently does nothing is its own
          // puzzle for the author who wrote it.
          console.warn(
            `${source}: ignored a link to "${url}", which would take Coilbox off screen. Only https, mailto and tel links open, and they open outside the app.`,
          );
        }}
      >
        {children}
      </a>
    );
  };
}
