import { type RefObject, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { quitApp } from "../general/quit";
import { resolveWelcomeAction } from "./welcomeActions";

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
 */
export function useWelcomeActionRef(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: Event) => {
      const marker = (e.target as HTMLElement).closest("[data-coilbox-action]");
      if (!marker) return;
      const action = resolveWelcomeAction(
        marker.getAttribute("data-coilbox-action"),
        marker.getAttribute("data-coilbox-route") ??
          marker.getAttribute("href"),
      );
      if (!action) return;
      // Prevent the default so an `<a href="@route/...">` marker can't send the
      // webview to a bogus URL. The resolved action drives the app instead.
      e.preventDefault();
      if (action.kind === "quit") quitApp();
      else navigate(action.to);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [navigate]);
  return ref;
}
