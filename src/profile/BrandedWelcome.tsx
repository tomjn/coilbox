import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { quitApp } from "../general/quit";
import { getProfile, getResolvedWelcome } from "./profile";
import { resolveWelcomeAction } from "./welcomeActions";
import { rewriteBrandedCss, rewriteBrandedHtml } from "./welcomeAssets";

/**
 * The branded welcome landing page: takes the whole home when the profile supplies
 * a `welcome`. Renders bundler-authored HTML plus its scoped CSS.
 *
 * The HTML is injected via `dangerouslySetInnerHTML`: it comes from a trusted,
 * bundler-controlled file shipped inside the distribution (same trust level as the
 * binary), and by design carries no `<script>` — declarative content only, so no
 * CSP relaxation is needed. Only rendered when `welcome` is present (CoilboxHome
 * picks the other arm otherwise), so this component always has content to show.
 *
 * Because the HTML can't run JavaScript, the one interactive hook an author gets is
 * the `data-coilbox-action` attribute: a delegated click handler on the container reads
 * it off the nearest ancestor of the click target. "quit" closes the app; "navigate"
 * goes to an in-app route named in `data-coilbox-route` (or the element's `href`) using
 * the same `@route/` scheme as custom markdown pages (see `resolveWelcomeAction`).
 */
export default function BrandedWelcome() {
  const welcome = getProfile().welcome;
  // `welcome.html`/`css` may be `@.coilbox/...` file references; they're resolved to
  // the referenced file's text at startup (see resolveWelcome), so read the resolved
  // strings here. Inline fragments resolve to themselves, so this is unchanged for them.
  const resolved = getResolvedWelcome();
  // Rewrite relative asset URLs (images/audio/video/fonts) to the `coilbox://`
  // protocol so a bundler can reference `.coilbox/`-relative files by path. Memoised
  // on the raw strings so the DOM parse runs once, not every render.
  const html = useMemo(
    () => (resolved?.html ? rewriteBrandedHtml(resolved.html) : undefined),
    [resolved?.html],
  );
  const css = useMemo(
    () => (resolved?.css ? rewriteBrandedCss(resolved.css) : undefined),
    [resolved?.css],
  );
  // Delegated listener attached to the injected-HTML container (not a JSX `onClick`,
  // which would trip a11y lints on a static div): a bubbled click on any element
  // carrying `data-coilbox-action` dispatches the resolved action (quit or navigate).
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
      // Prevent the default so an `<a href="@route/...">` marker can't send the webview
      // to a bogus URL; the resolved action drives the app instead.
      e.preventDefault();
      if (action.kind === "quit") quitApp();
      else navigate(action.to);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [navigate]);

  if (!welcome) return null;
  return (
    // Natural height (not `h-full`): the BrandedHome scroll container sizes and scrolls
    // this, so a short welcome can't collapse to zero the way `height:100%` does
    // against an auto-height parent inside picoframe's overflow-auto content region.
    <section className="w-full">
      {resolved?.error && (
        <div className="m-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {resolved.error}
        </div>
      )}
      {css && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored profile CSS
        <style dangerouslySetInnerHTML={{ __html: css }} />
      )}
      {html && (
        <div
          ref={ref}
          className="coilbox-welcome"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored profile HTML
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </section>
  );
}
