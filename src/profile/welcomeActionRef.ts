import { openUrl } from "@tauri-apps/plugin-opener";
import { type RefObject, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { quitApp } from "../general/quit";
import { resolveWelcomeAction } from "./welcomeActions";

/** The four `href` schemes that belong to another program rather than to Coilbox. */
const EXTERNAL = /^(https?:|mailto:|tel:)/i;
/** The Windows spelling of a `coilbox://` asset URL, which reads as an `http:` one. */
const ASSET_URL = /^https?:[/][/]coilbox[.]localhost[/]/i;

/** What clicking an `<a href>` in distribution markup should do. See {@link classifyLink}. */
export type LinkHandling = "in-app" | "external" | "ignore";

/**
 * Where a link written in distribution markup is allowed to lead.
 *
 * An allowlist, because the shapes that strand the webview outnumber the ones
 * that work and an author can invent more of them. Three answers:
 *
 * - `"in-app"` for `#/play/skirmish`, the documented spelling of an in-app link
 *   under hash routing. The webview follows it and the router picks it up.
 * - `"external"` for `https:`, `http:`, `mailto:` and `tel:`, which are ordinary
 *   links a distribution is meant to be able to write but lead somewhere Coilbox
 *   cannot draw. The OS opens them in a browser, a mail client or a dialler, and
 *   Coilbox stays on screen (issue #1777). These are also exactly the four
 *   schemes `opener:default` permits, so nothing here can ask for more than the
 *   capability grants.
 * - `"ignore"` for everything else, which is an author's mistake:
 *   - a relative `href="images/logo.webp"`, which the asset rewrite has already
 *     turned into the `coilbox://` URL of a picture, so following it replaces
 *     Coilbox with that picture
 *   - an `@route/` or `@widget/` reference whose `data-coilbox-action` marker is
 *     missing or misspelled, which resolves against the app origin as a path that
 *     does not exist
 *   - an app-absolute `/play/skirmish`, which is a full page load rather than the
 *     in-app navigation it looks like
 *
 * The Windows asset URL is spelled `http://coilbox.localhost/…` rather than
 * `coilbox://…` (see {@link ../lib/assetUrl}), so it has to be excluded by hand
 * or the `http:` rule lets it through on Windows only.
 */
export function classifyLink(href: string): LinkHandling {
  const h = href.trim();
  if (h.startsWith("#")) return "in-app";
  if (EXTERNAL.test(h) && !ASSET_URL.test(h)) return "external";
  return "ignore";
}

/**
 * The click delegation that makes `data-coilbox-action` work, as a ref to put on
 * whatever element holds the injected markup.
 *
 * Distribution markup carries no JavaScript by design (see {@link
 * ./BrandedWelcome} for why), so the one interactive hook an author gets is that
 * attribute. A bubbled click on any element carrying it dispatches the action
 * {@link resolveWelcomeAction} names: "quit" closes the app, "navigate" goes to
 * the in-app route in `data-coilbox-route` (or the element's `href`).
 *
 * A delegated listener rather than a JSX `onClick`, which would trip the a11y
 * lints on a static div. Lifted out of `BrandedWelcome` when the home page's
 * `before`/`after`/`html` markup needed the same behaviour (issue #999). One
 * implementation, so a marker means the same thing wherever a distribution
 * writes it, and so there is one place to audit.
 *
 * The same listener catches a clicked `<a>` that has no action, because letting
 * the webview follow one takes the whole app off screen and only a restart
 * brings it back: a link to nowhere did that in issue #1062, and a perfectly
 * good `https:` link did it in issue #1777. See {@link classifyLink}.
 */
export function useWelcomeActionRef(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const marker = target.closest("[data-coilbox-action]");
      const action = marker
        ? resolveWelcomeAction(
            marker.getAttribute("data-coilbox-action"),
            marker.getAttribute("data-coilbox-route") ??
              marker.getAttribute("href"),
          )
        : null;
      if (action) {
        // Prevent the default so an `<a href="@route/...">` marker can't send the
        // webview to a bogus URL. The resolved action drives the app instead.
        e.preventDefault();
        if (action.kind === "quit") quitApp();
        else navigate(action.to);
        return;
      }
      // Nothing to dispatch, so the webview is about to follow the anchor
      // itself. Only a hash link may do that.
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const handling = classifyLink(href);
      if (handling === "in-app") return;
      e.preventDefault();
      if (handling === "external") {
        // The OS opens it beside Coilbox instead of on top of it. A rejection is
        // logged and swallowed, as everywhere else the app opens a link: the
        // user asked to leave, and Coilbox has nothing to show them if the OS
        // refuses.
        openUrl(href).catch((err) =>
          console.warn(`profile: could not open external link "${href}"`, err),
        );
        return;
      }
      // Say which link it was: a click that silently does nothing is its own
      // puzzle for the author who wrote the markup.
      console.warn(
        `profile: ignored a link to "${href}", which would leave Coilbox. Write an in-app link as "#/play/skirmish", or add a data-coilbox-action="navigate" marker.`,
      );
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [navigate]);
  return ref;
}
