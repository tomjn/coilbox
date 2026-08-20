import { type RefObject, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { quitApp } from "../general/quit";
import { resolveWelcomeAction } from "./welcomeActions";

/** The four `href` shapes the webview can follow and still be showing Coilbox. */
const FOLLOWABLE = /^(https?:|mailto:|tel:|#)/i;
/** The Windows spelling of a `coilbox://` asset URL, which reads as an `http:` one. */
const ASSET_URL = /^https?:[/][/]coilbox[.]localhost[/]/i;

/**
 * Whether the webview can follow this `<a href>` without leaving the app.
 *
 * An allowlist, because the shapes that strand the webview outnumber the ones
 * that work and an author can invent more of them. `https:`, `mailto:` and
 * `tel:` are ordinary links a distribution is meant to be able to write, and
 * `#/play/skirmish` is the documented spelling of an in-app link under hash
 * routing. Everything else is an author's mistake:
 *
 * - a relative `href="images/logo.webp"`, which the asset rewrite has already
 *   turned into the `coilbox://` URL of a picture, so following it replaces
 *   Coilbox with that picture
 * - an `@route/` or `@widget/` reference whose `data-coilbox-action` marker is
 *   missing or misspelled, which resolves against the app origin as a path that
 *   does not exist
 * - an app-absolute `/play/skirmish`, which is a full page load rather than the
 *   in-app navigation it looks like
 *
 * The Windows asset URL is spelled `http://coilbox.localhost/…` rather than
 * `coilbox://…` (see {@link ../lib/assetUrl}), so it has to be excluded by hand
 * or the first rule lets it through on Windows only.
 */
export function canWebviewFollow(href: string): boolean {
  const h = href.trim();
  return FOLLOWABLE.test(h) && !ASSET_URL.test(h);
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
 * The same listener catches a clicked `<a>` that has no action and nowhere to
 * go, because following it takes the whole webview out of Coilbox and only a
 * restart brings it back (issue #1062). See {@link canWebviewFollow}.
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
      // itself. Stop it when there is nothing at the other end, and say which
      // link it was: a click that silently does nothing is its own puzzle for
      // the author who wrote the markup.
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (canWebviewFollow(href)) return;
      e.preventDefault();
      console.warn(
        `profile: ignored a link to "${href}", which would leave Coilbox. Write an in-app link as "#/play/skirmish", or add a data-coilbox-action="navigate" marker.`,
      );
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [navigate]);
  return ref;
}
